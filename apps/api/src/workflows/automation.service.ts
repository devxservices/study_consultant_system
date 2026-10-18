import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  automationRuleSchema,
  caseFacts,
  evaluateConditions,
  formatMoney,
  hasPermission,
  renderMessage,
  type AuthUser,
  type AutomationAction,
  type AutomationRuleInput,
  type AutomationRuleView,
  type AutomationRunStatus,
  type AutomationRunView,
  type AutomationRunsQuery,
  type AutomationTrigger,
  type ConditionFacts,
  type MessageAudience,
  type Paginated,
  type StageFee,
  type StageMessage,
  type StageTask,
  STAGE_DEFINITIONS,
  type Stage,
  localIsoDate,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import {
  automationRules,
  automationRuns,
  cases,
  clients,
  consultants,
  tasks,
  users,
  workflowTemplates,
  workflowVersions,
} from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService, textToHtml } from '../mail/mail.service';
import { MessagingService } from '../mail/messaging.service';
import { EntitlementsService } from '../tenancy/entitlements.service';
import { tenantIdentity } from '../tenancy/tenant-links';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { addDays, iso, page, today } from '../common/db-helpers';
import { WorkflowsService } from './workflows.service';
import type { StageRow } from './stage-rows';

/** Automations moving applications that fire automations: stop after this many hops. */
const MAX_DEPTH = 3;

type Result = { action: string; ok: boolean; detail: string };

export interface AutomationEvent {
  trigger: AutomationTrigger;
  tenantId: string;
  caseId: string;
  /** Who caused it; null for the clock. */
  actor: AuthUser | null;
  stageKey?: string | null;
  documentType?: string | null;
  /** Unique per occurrence, so a firing happens once even if seen twice. */
  eventKey: string;
  depth?: number;
}

/** What moving and status changes look like from here - CasesService implements them. */
export interface CaseMover {
  moveByAutomation(caseId: string, stageKey: string, ruleName: string, depth: number): Promise<string>;
  setStatusByAutomation(caseId: string, status: 'active' | 'on_hold' | 'withdrawn', ruleName: string): Promise<string>;
}

interface CaseContext {
  id: string;
  tenantId: string;
  reference: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientUserId: string | null;
  leadSource: string | null;
  consultantUserId: string | null;
  consultantName: string | null;
  consultantEmail: string | null;
  consultantPhone: string | null;
  targetCountry: string;
  targetUniversity: string | null;
  studyLevel: string | null;
  visaType: string | null;
  intake: string | null;
  status: string;
  currentStage: string;
  currentStageKey: string | null;
  stageEnteredAt: Date;
  workflowVersionId: string | null;
  templateId: string | null;
}

/**
 * Automations: "when this happens to an application, if these hold, do
 * these things" - and the same machinery runs each stage's own tasks, fees
 * and messages when an application enters it.
 *
 * Every firing is written to automation_runs with what each action did or
 * why it could not, so nothing an automation does is invisible. Like
 * notifications, a failing automation never undoes the action that set it
 * off: the stage move or the document review stands.
 */
@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);
  /** Other modules that act on application events (commissions, partners), outside the rules. */
  private readonly listeners: ((event: AutomationEvent) => Promise<void>)[] = [];

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly messaging: MessagingService,
    private readonly entitlements: EntitlementsService,
    private readonly workflows: WorkflowsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Rules                                                             */
  /* ---------------------------------------------------------------- */

  async list(actor: AuthUser): Promise<AutomationRuleView[]> {
    const rows = await this.db
      .select({ rule: automationRules, workflowName: workflowTemplates.name, createdByName: users.fullName })
      .from(automationRules)
      .leftJoin(workflowTemplates, eq(workflowTemplates.id, automationRules.workflowId))
      .leftJoin(users, eq(users.id, automationRules.createdBy))
      .where(and(eq(automationRules.tenantId, tenantOf(actor)), isNull(automationRules.deletedAt)))
      .orderBy(desc(automationRules.enabled), automationRules.name);
    return rows.map((r) => toRuleView(r.rule, r.workflowName, r.createdByName));
  }

  async get(actor: AuthUser, id: string): Promise<AutomationRuleView> {
    const [r] = await this.db
      .select({ rule: automationRules, workflowName: workflowTemplates.name, createdByName: users.fullName })
      .from(automationRules)
      .leftJoin(workflowTemplates, eq(workflowTemplates.id, automationRules.workflowId))
      .leftJoin(users, eq(users.id, automationRules.createdBy))
      .where(and(eq(automationRules.id, id), eq(automationRules.tenantId, tenantOf(actor)), isNull(automationRules.deletedAt)))
      .limit(1);
    if (!r) throw new NotFoundException('Automation not found.');
    return toRuleView(r.rule, r.workflowName, r.createdByName);
  }

  async create(actor: AuthUser, input: AutomationRuleInput): Promise<AutomationRuleView> {
    const rule = automationRuleSchema.parse(input);
    await this.assertTargets(actor, rule);
    const [row] = await this.db
      .insert(automationRules)
      .values({
        tenantId: tenantOf(actor),
        name: rule.name,
        enabled: rule.enabled,
        trigger: rule.trigger,
        workflowId: rule.workflowId ?? null,
        stageKey: rule.stageKey ?? null,
        documentType: rule.documentType ?? null,
        conditions: rule.conditions,
        actions: rule.actions,
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .returning({ id: automationRules.id });
    await this.audit.record(actor, {
      action: 'automation.saved',
      entityType: 'automation',
      entityId: row!.id,
      metadata: { name: rule.name, trigger: rule.trigger, actions: rule.actions.map((a) => a.type), created: true },
    });
    return this.get(actor, row!.id);
  }

  async update(actor: AuthUser, id: string, input: AutomationRuleInput): Promise<AutomationRuleView> {
    await this.get(actor, id);
    const rule = automationRuleSchema.parse(input);
    await this.assertTargets(actor, rule);
    await this.db
      .update(automationRules)
      .set({
        name: rule.name,
        enabled: rule.enabled,
        trigger: rule.trigger,
        workflowId: rule.workflowId ?? null,
        stageKey: rule.stageKey ?? null,
        documentType: rule.documentType ?? null,
        conditions: rule.conditions,
        actions: rule.actions,
        updatedBy: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(automationRules.id, id));
    await this.audit.record(actor, {
      action: 'automation.saved',
      entityType: 'automation',
      entityId: id,
      metadata: { name: rule.name, trigger: rule.trigger, enabled: rule.enabled },
    });
    return this.get(actor, id);
  }

  async setEnabled(actor: AuthUser, id: string, enabled: boolean): Promise<AutomationRuleView> {
    const current = await this.get(actor, id);
    await this.db.update(automationRules).set({ enabled, updatedBy: actor.id, updatedAt: new Date() }).where(eq(automationRules.id, id));
    await this.audit.record(actor, { action: 'automation.saved', entityType: 'automation', entityId: id, metadata: { name: current.name, enabled } });
    return this.get(actor, id);
  }

  /** Soft: its run history stays readable. */
  async remove(actor: AuthUser, id: string): Promise<void> {
    const current = await this.get(actor, id);
    await this.db.update(automationRules).set({ deletedAt: new Date(), enabled: false, updatedBy: actor.id }).where(eq(automationRules.id, id));
    await this.audit.record(actor, { action: 'automation.deleted', entityType: 'automation', entityId: id, metadata: { name: current.name } });
  }

  async runs(actor: AuthUser, query: AutomationRunsQuery): Promise<Paginated<AutomationRunView>> {
    const where = and(
      eq(automationRuns.tenantId, tenantOf(actor)),
      query.ruleId ? eq(automationRuns.ruleId, query.ruleId) : undefined,
      query.status ? eq(automationRuns.status, query.status) : undefined,
    );
    const [[count], rows] = await Promise.all([
      this.db.select({ n: sql<number>`count(*)::int` }).from(automationRuns).where(where),
      this.db
        .select({
          run: automationRuns,
          ruleName: automationRules.name,
          reference: cases.reference,
          clientName: clients.fullName,
        })
        .from(automationRuns)
        .leftJoin(automationRules, eq(automationRules.id, automationRuns.ruleId))
        .leftJoin(cases, eq(cases.id, automationRuns.caseId))
        .leftJoin(clients, eq(clients.id, cases.clientId))
        .where(where)
        .orderBy(desc(automationRuns.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
    ]);
    return page(
      rows.map((r) => ({
        id: r.run.id,
        ruleId: r.run.ruleId ?? '',
        ruleName: r.ruleName ?? `Stage “${r.run.stageKey ?? '?'}” on entry`,
        trigger: r.run.trigger as AutomationTrigger,
        status: r.run.status as AutomationRunStatus,
        caseId: r.run.caseId,
        caseReference: r.reference,
        clientName: r.clientName,
        results: r.run.results as AutomationRunView['results'],
        createdAt: iso(r.run.createdAt),
      })),
      count?.n ?? 0,
      query.page,
      query.pageSize,
    );
  }

  /** The workflow a rule names is this consultancy's, and the stages it names exist in it. */
  private async assertTargets(actor: AuthUser, rule: ReturnType<typeof automationRuleSchema.parse>): Promise<void> {
    if (!rule.workflowId) return;
    const detail = await this.workflows.detail(actor, rule.workflowId);
    const stages = detail.currentStages ?? detail.draftStages ?? [];
    const keys = new Set(stages.map((s) => s.key));
    if (rule.stageKey && !keys.has(rule.stageKey)) {
      throw new BadRequestException({ message: `“${detail.name}” has no stage “${rule.stageKey}”.`, fieldErrors: { stageKey: 'Pick one of its stages' } });
    }
    for (const a of rule.actions) {
      if (a.type === 'move_stage' && !keys.has(a.stageKey)) {
        throw new BadRequestException(`“${detail.name}” has no stage “${a.stageKey}” to move to.`);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Firing                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * An application entered a stage: run the stage's own tasks, fees and
   * messages, tell approvers if it needs signing off, then the automations
   * listening for it.
   */
  async stageEntered(caseId: string, stage: StageRow, eventId: string, actor: AuthUser | null, depth = 0): Promise<void> {
    try {
      const ctx = await this.context(caseId);
      if (!ctx) return;
      const hasOwn = stage.tasks.length + stage.fees.length + stage.messages.length > 0;
      if (hasOwn) {
        const claimed = await this.claim(ctx.tenantId, null, stage.key, caseId, 'stage_entered', `stage:${eventId}`);
        if (claimed) {
          const results: Result[] = [];
          for (const t of stage.tasks) results.push(await this.createTask(ctx, t, actor, `Stage “${stage.name}”`));
          for (const f of stage.fees) results.push(await this.fee(ctx, f, actor, stage.name));
          for (const m of stage.messages) results.push(await this.sendMessage(ctx, m, stage));
          await this.finish(claimed, results);
        }
      }
      if (stage.approvalRequired) await this.askForApproval(ctx, stage);
      await this.fire({ trigger: 'stage_entered', tenantId: ctx.tenantId, caseId, actor, stageKey: stage.key, eventKey: `entered:${eventId}`, depth }, ctx);
    } catch (err) {
      this.logger.error(`Stage actions failed for case ${caseId}`, err as Error);
    }
  }

  /**
   * Lets another module hear every application event - a commission becoming
   * expected when the deposit is paid, say. Listeners run before the rules,
   * each on its own: one failing never stops the others or the rules.
   */
  listen(fn: (event: AutomationEvent) => Promise<void>): void {
    this.listeners.push(fn);
  }

  /** Run the automations listening for this event. Never throws. */
  async fire(event: AutomationEvent, known?: CaseContext): Promise<void> {
    for (const fn of this.listeners) {
      try {
        await fn(event);
      } catch (err) {
        this.logger.error(`A listener failed on ${event.trigger} for case ${event.caseId}`, err as Error);
      }
    }
    try {
      const rules = await this.db
        .select()
        .from(automationRules)
        .where(
          and(
            eq(automationRules.tenantId, event.tenantId),
            eq(automationRules.trigger, event.trigger),
            eq(automationRules.enabled, true),
            isNull(automationRules.deletedAt),
          ),
        );
      if (rules.length === 0) return;
      const ctx = known ?? (await this.context(event.caseId));
      if (!ctx) return;
      const facts: ConditionFacts = {
        ...caseFacts(ctx),
        stageKey: event.stageKey ?? ctx.currentStageKey,
        stageCategory: ctx.currentStage,
        documentType: event.documentType ?? null,
        daysInStage: Math.floor((Date.now() - new Date(ctx.stageEnteredAt).getTime()) / 86_400_000),
      };
      const depth = event.depth ?? 0;
      for (const rule of rules) {
        if (rule.workflowId && rule.workflowId !== ctx.templateId) continue;
        if (rule.stageKey && rule.stageKey !== event.stageKey) continue;
        if (rule.documentType && rule.documentType !== event.documentType) continue;
        if (!evaluateConditions(rule.conditions, facts)) continue;

        const claimed = await this.claim(ctx.tenantId, rule.id, null, ctx.id, event.trigger, `${rule.id}:${event.eventKey}`);
        if (!claimed) continue;
        if (depth >= MAX_DEPTH) {
          await this.finish(claimed, [
            { action: 'stopped', ok: false, detail: `Not run: automations set each other off more than ${MAX_DEPTH} times in a row.` },
          ], 'skipped');
          continue;
        }
        const results: Result[] = [];
        for (const action of rule.actions) results.push(await this.execute(ctx, action, event.actor, rule.name, depth));
        await this.finish(claimed, results);
        await this.db
          .update(automationRules)
          .set({ runCount: sql`${automationRules.runCount} + 1`, lastRunAt: new Date() })
          .where(eq(automationRules.id, rule.id));
      }
    } catch (err) {
      this.logger.error(`Automations failed for ${event.trigger} on case ${event.caseId}`, err as Error);
    }
  }

  /** Writes the run row first, so a second sighting of the same event does nothing. */
  private async claim(
    tenantId: string,
    ruleId: string | null,
    stageKey: string | null,
    caseId: string,
    trigger: string,
    eventKey: string,
  ): Promise<string | null> {
    const [row] = await this.db
      .insert(automationRuns)
      .values({ tenantId, ruleId, stageKey, caseId, trigger, status: 'done', eventKey })
      .onConflictDoNothing()
      .returning({ id: automationRuns.id });
    return row?.id ?? null;
  }

  private async finish(runId: string, results: Result[], status?: AutomationRunStatus): Promise<void> {
    const failed = results.filter((r) => !r.ok).length;
    await this.db
      .update(automationRuns)
      .set({
        results,
        status: status ?? (failed === 0 ? 'done' : failed === results.length ? 'failed' : 'partial'),
      })
      .where(eq(automationRuns.id, runId));
  }

  private async execute(ctx: CaseContext, action: AutomationAction, actor: AuthUser | null, ruleName: string, depth: number): Promise<Result> {
    try {
      switch (action.type) {
        case 'create_task':
          return await this.createTask(ctx, action.task, actor, `Automation “${ruleName}”`);
        case 'notify': {
          const vars = await this.vars(ctx, null, action.audience);
          const recipients = await this.recipientUsers(ctx, action.audience);
          if (recipients.length === 0) return { action: 'notify', ok: false, detail: `No one to tell: ${audienceGap(action.audience)}.` };
          await this.notifications.pushMany(recipients, {
            type: 'workflow_alert',
            title: renderMessage(action.title, vars),
            body: renderMessage(action.body, vars) || null,
            link: action.audience === 'student' ? '/portal' : `${action.audience === 'managers' ? '/overview' : '/desk'}/cases/${ctx.id}`,
            caseId: ctx.id,
          });
          return { action: 'notify', ok: true, detail: `Told ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'}.` };
        }
        case 'send_message':
          return await this.sendMessage(ctx, action.message, null);
        case 'move_stage':
          return { action: 'move_stage', ok: true, detail: await this.mover().moveByAutomation(ctx.id, action.stageKey, ruleName, depth + 1) };
        case 'set_status':
          return { action: 'set_status', ok: true, detail: await this.mover().setStatusByAutomation(ctx.id, action.status, ruleName) };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { action: action.type, ok: false, detail: message };
    }
  }

  private mover(): CaseMover {
    // Resolved lazily: the cases service also depends on this one.
    const { CasesService } = require('../cases/cases.service') as typeof import('../cases/cases.service');
    return this.moduleRef.get(CasesService, { strict: false });
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * A task on the application. "Consultant" is the application's consultant
   * (the student's, when the application has none); "managers" is the
   * consultancy's first manager - a task has one owner, and managers see
   * every task anyway.
   */
  private async createTask(ctx: CaseContext, t: StageTask, actor: AuthUser | null, source: string): Promise<Result> {
    const assignee = t.assignee === 'consultant' ? ctx.consultantUserId ?? (await this.firstManager(ctx.tenantId)) : await this.firstManager(ctx.tenantId);
    if (!assignee) return { action: 'create_task', ok: false, detail: 'No one to give the task to.' };
    const vars = await this.vars(ctx, null, 'consultant');
    const title = renderMessage(t.title, vars);
    const due = new Date(Date.now() + t.dueInDays * 86_400_000);
    due.setHours(17, 0, 0, 0);
    const [row] = await this.db
      .insert(tasks)
      .values({
        tenantId: ctx.tenantId,
        title,
        notes: [t.notes ? renderMessage(t.notes, vars) : null, `Created automatically: ${source}.`].filter(Boolean).join('\n\n'),
        clientId: ctx.clientId,
        caseId: ctx.id,
        assigneeId: assignee,
        createdBy: actor && actor.role !== 'client' ? actor.id : null,
        dueAt: due,
        priority: t.priority,
      })
      .returning({ id: tasks.id });
    await this.audit.record(null, {
      action: 'task.created',
      entityType: 'task',
      tenantId: ctx.tenantId,
      entityId: row!.id,
      caseId: ctx.id,
      clientId: ctx.clientId,
      metadata: { title, assigneeId: assignee, automatic: source },
    });
    const [who] = await this.db.select({ role: users.role, name: users.fullName }).from(users).where(eq(users.id, assignee)).limit(1);
    await this.notifications.push({
      userId: assignee,
      type: 'task_assigned',
      title: `New task: ${title}`,
      body: `${ctx.clientName} · ${ctx.reference}`,
      link: who?.role === 'manager' ? '/overview/tasks' : '/desk/tasks',
      caseId: ctx.id,
    });
    return { action: 'create_task', ok: true, detail: `“${title}” for ${who?.name ?? 'staff'}, due ${localIsoDate(due)}.` };
  }

  /**
   * A stage fee. Issued as an invoice when the stage says so, the
   * consultancy has billing and a member of staff made the move (an
   * invoice is issued in someone's name); otherwise it becomes a task to
   * collect it, so it is never silently dropped.
   */
  private async fee(ctx: CaseContext, f: StageFee, actor: AuthUser | null, stageName: string): Promise<Result> {
    const amount = formatMoney(f.amount, f.currency);
    if (f.mode === 'invoice' && actor && (actor.role === 'manager' || (actor.role === 'consultant' && hasPermission(actor, 'billing.invoice')))) {
      if (await this.entitlements.hasModule(ctx.tenantId, 'billing')) {
        const { BillingService } = require('../billing/billing.service') as typeof import('../billing/billing.service');
        const billing = this.moduleRef.get(BillingService, { strict: false });
        const invoice = await billing.create(actor, {
          clientId: ctx.clientId,
          caseId: ctx.id,
          currency: f.currency,
          dueDate: addDays(today(), f.dueInDays),
          items: [{ description: f.label, quantity: 1, unitAmount: f.amount }],
          notes: `Raised when the application reached “${stageName}”.`,
        });
        return { action: 'fee', ok: true, detail: `Invoice ${invoice.number} for ${amount} issued.` };
      }
    }
    const task = await this.createTask(
      ctx,
      { title: `Collect fee: ${f.label} (${amount})`, dueInDays: f.dueInDays, assignee: 'consultant', priority: 'high', notes: undefined },
      actor,
      `Stage “${stageName}” fee`,
    );
    return { action: 'fee', ok: task.ok, detail: task.ok ? `To collect ${amount}: ${task.detail}` : task.detail };
  }

  /** In the app, by email, SMS or WhatsApp - to the student, their consultant or the managers. */
  private async sendMessage(ctx: CaseContext, m: StageMessage, stage: StageRow | null): Promise<Result> {
    const vars = await this.vars(ctx, stage, m.audience);
    const subject = renderMessage(m.subject, vars);
    const body = renderMessage(m.body, vars);
    const sent: string[] = [];
    const missed: string[] = [];
    const site = await tenantIdentity(this.db, ctx.tenantId);

    if (m.channels.includes('in_app')) {
      const recipients = await this.recipientUsers(ctx, m.audience);
      if (recipients.length) {
        await this.notifications.pushMany(recipients, {
          type: m.audience === 'student' ? 'stage_changed' : 'workflow_alert',
          title: subject,
          body,
          link: m.audience === 'student' ? '/portal' : `${m.audience === 'managers' ? '/overview' : '/desk'}/cases/${ctx.id}`,
          caseId: ctx.id,
        });
        sent.push('in the app');
      } else missed.push(`in the app (${audienceGap(m.audience)})`);
    }
    const contacts = await this.contacts(ctx, m.audience);
    if (m.channels.includes('email')) {
      const to = contacts.map((c) => c.email).filter((e): e is string => Boolean(e));
      if (to.length) {
        const text = `${body}\n\n${site.name}${site.contactPhone ? ` · ${site.contactPhone}` : ''}`;
        for (const address of to) {
          await this.mail.send({ to: address, subject, text, html: textToHtml(text), fromName: site.name, replyTo: site.contactEmail ?? undefined });
        }
        sent.push(`email (${to.length})`);
      } else missed.push('email (no address)');
    }
    for (const channel of ['sms', 'whatsapp'] as const) {
      if (!m.channels.includes(channel)) continue;
      const to = contacts.map((c) => c.phone).filter((p): p is string => Boolean(p));
      if (to.length === 0) {
        missed.push(`${channel === 'sms' ? 'SMS' : 'WhatsApp'} (no phone number)`);
        continue;
      }
      let ok = 0;
      for (const phone of to) if (await this.messaging.send({ channel, to: phone, body: `${subject}\n${body}` })) ok++;
      if (ok) sent.push(`${channel === 'sms' ? 'SMS' : 'WhatsApp'} (${ok})`);
      else missed.push(`${channel === 'sms' ? 'SMS' : 'WhatsApp'} (not delivered)`);
    }
    const detail = `“${subject}” to ${m.audience}: ${sent.length ? `sent ${sent.join(', ')}` : 'not sent'}${missed.length ? `; not sent ${missed.join(', ')}` : ''}.`;
    return { action: 'send_message', ok: sent.length > 0 && missed.length === 0, detail };
  }

  /**
   * Managers hear about a stage waiting for sign-off. Others who may approve
   * (the case.approve permission) find it on the board's "Awaiting approval".
   */
  private async askForApproval(ctx: CaseContext, stage: StageRow): Promise<void> {
    const approvers = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, ctx.tenantId), eq(users.isActive, true), eq(users.role, 'manager')));
    await this.notifications.pushMany(
      approvers.map((a) => a.id),
      {
        type: 'approval_needed',
        title: `${ctx.clientName}’s application needs your sign-off`,
        body: `${ctx.reference} reached “${stage.name}”, which needs approval before it moves on.`,
        link: `/overview/cases/${ctx.id}`,
        caseId: ctx.id,
      },
    );
  }

  /* ---------------------------------------------------------------- */
  /* Context                                                           */
  /* ---------------------------------------------------------------- */

  private async context(caseId: string): Promise<CaseContext | null> {
    const [row] = await this.db
      .select({
        id: cases.id,
        tenantId: cases.tenantId,
        reference: cases.reference,
        clientId: cases.clientId,
        clientName: clients.fullName,
        clientEmail: clients.email,
        clientPhone: clients.phone,
        clientUserId: clients.userId,
        leadSource: clients.leadSource,
        consultantUserId: users.id,
        consultantName: users.fullName,
        consultantEmail: users.email,
        consultantPhone: users.phone,
        targetCountry: cases.targetCountry,
        targetUniversity: cases.targetUniversity,
        studyLevel: cases.studyLevel,
        visaType: cases.visaType,
        intake: cases.intake,
        status: cases.status,
        currentStage: cases.currentStage,
        currentStageKey: cases.currentStageKey,
        stageEnteredAt: cases.stageEnteredAt,
        workflowVersionId: cases.workflowVersionId,
        templateId: workflowVersions.templateId,
      })
      .from(cases)
      .innerJoin(clients, eq(clients.id, cases.clientId))
      // The application's consultant, or failing that the student's.
      .leftJoin(consultants, eq(consultants.id, sql`coalesce(${cases.consultantId}, ${clients.assignedConsultantId})`))
      .leftJoin(users, eq(users.id, consultants.userId))
      .leftJoin(workflowVersions, eq(workflowVersions.id, cases.workflowVersionId))
      .where(eq(cases.id, caseId))
      .limit(1);
    return row ?? null;
  }

  private async firstManager(tenantId: string): Promise<string | null> {
    const [m] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, 'manager'), eq(users.isActive, true)))
      .orderBy(users.createdAt)
      .limit(1);
    return m?.id ?? null;
  }

  private async recipientUsers(ctx: CaseContext, audience: MessageAudience): Promise<string[]> {
    if (audience === 'student') return ctx.clientUserId ? [ctx.clientUserId] : [];
    if (audience === 'consultant') return ctx.consultantUserId ? [ctx.consultantUserId] : [];
    const managers = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, ctx.tenantId), eq(users.role, 'manager'), eq(users.isActive, true)));
    return managers.map((m) => m.id);
  }

  private async contacts(ctx: CaseContext, audience: MessageAudience): Promise<{ email: string | null; phone: string | null }[]> {
    if (audience === 'student') return [{ email: ctx.clientEmail, phone: ctx.clientPhone }];
    if (audience === 'consultant') return ctx.consultantUserId ? [{ email: ctx.consultantEmail, phone: ctx.consultantPhone }] : [];
    return this.db
      .select({ email: users.email, phone: users.phone })
      .from(users)
      .where(and(eq(users.tenantId, ctx.tenantId), eq(users.role, 'manager'), eq(users.isActive, true)));
  }

  private async vars(ctx: CaseContext, stage: StageRow | null, audience: MessageAudience): Promise<Record<string, string | null>> {
    const site = await tenantIdentity(this.db, ctx.tenantId);
    let stageRow = stage;
    if (!stageRow && ctx.workflowVersionId) {
      stageRow = (await this.workflows.stagesOf(ctx.workflowVersionId)).find((s) => s.key === ctx.currentStageKey) ?? null;
    }
    return {
      student: ctx.clientName,
      first_name: ctx.clientName.split(' ')[0] ?? ctx.clientName,
      reference: ctx.reference,
      // An application on no workflow still has its standard stage: never a blank.
      stage: stageRow
        ? audience === 'student'
          ? stageRow.clientLabel
          : stageRow.name
        : (STAGE_DEFINITIONS[ctx.currentStage as Stage]?.[audience === 'student' ? 'clientLabel' : 'label'] ?? null),
      country: ctx.targetCountry,
      university: ctx.targetUniversity ?? 'your university',
      consultant: ctx.consultantName ?? 'your consultant',
      agency: site.name,
      portal_link: `${site.origin}/portal`,
    };
  }
}

function audienceGap(audience: MessageAudience): string {
  return audience === 'student' ? 'the student has no portal login' : audience === 'consultant' ? 'no consultant assigned' : 'no active managers';
}

function toRuleView(
  r: typeof automationRules.$inferSelect,
  workflowName: string | null,
  createdByName: string | null,
): AutomationRuleView {
  return {
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    trigger: r.trigger as AutomationTrigger,
    workflowId: r.workflowId,
    workflowName,
    stageKey: r.stageKey,
    documentType: r.documentType,
    conditions: r.conditions,
    actions: r.actions,
    runCount: r.runCount,
    lastRunAt: r.lastRunAt ? iso(r.lastRunAt) : null,
    createdByName,
    updatedAt: iso(r.updatedAt),
  };
}
