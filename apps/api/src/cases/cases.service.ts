import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  DOCUMENT_TYPES,
  STAGE_DEFINITIONS,
  caseFacts,
  checkWorkflowTransition,
  computeRequirementProgress,
  hasPermission,
  nextStageKey,
  stageApplies,
  type AuthUser,
  type CaseStatus,
  type CaseWorkflowView,
  type ChangeCaseStatusInput,
  type ChangeCaseWorkflowInput,
  type ChangeStageInput,
  type ConditionFacts,
  type CreateCaseInput,
  type DocumentStatus,
  type OfferType,
  type Stage,
  type StageProgress,
  type UpdateCaseInput,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import {
  caseStageEvents,
  cases,
  institutions,
  clients,
  consultants,
  documentTypes,
  documents,
  users,
  workflowStages,
  workflowTemplates,
  workflowVersions,
} from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { seesAll } from '../auth/permissions';
import { NotificationsService } from '../notifications/notifications.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { AutomationService, type CaseMover } from '../workflows/automation.service';
import type { StageRow } from '../workflows/stage-rows';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const BUILT_IN_TYPES = new Set<string>(DOCUMENT_TYPES);

export interface StageHistoryEntry {
  id: string;
  /** The category - one of the ten. */
  stage: Stage;
  /** The stage itself, and its name in the workflow version it was on. */
  stageKey: string | null;
  stageName: string | null;
  enteredAt: string;
  completedAt: string | null;
  method: 'auto' | 'manual' | 'initial';
  changedBy: string | null;
  changedByName: string | null;
  note: string | null;
}

export interface CaseDetail {
  id: string;
  reference: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientUserId: string | null;
  consultantId: string | null;
  consultantName: string | null;
  targetCountry: string;
  targetUniversity: string | null;
  targetProgram: string | null;
  studyLevel: string | null;
  visaType: string | null;
  intake: string | null;
  /** The category of the current stage, which every dashboard reads. */
  currentStage: Stage;
  currentStageKey: string | null;
  currentStageName: string | null;
  status: CaseStatus;
  notes: string | null;
  stageEnteredAt: string;
  lastActivityAt: string;
  createdAt: string;
  closedAt: string | null;
  applicationDeadline: string | null;
  offerType: OfferType | null;
  offerConditions: string | null;
  offerDeadline: string | null;
  visaAppointmentAt: string | null;
  travelDate: string | null;
  daysInStage: number;
  /** Days without movement before it counts as stuck, for this stage. */
  stageSlaDays: number;
  isStuck: boolean;
  progress: StageProgress;
  history: StageHistoryEntry[];
  workflow: CaseWorkflowView | null;
  /** The institution from the catalogue, and what commission is worked out on. */
  institutionId: string | null;
  institutionName: string | null;
  tuitionFee: number | null;
  tuitionCurrency: string | null;
  scholarship: number | null;
  courseStart: string | null;
}

type CaseRow = typeof cases.$inferSelect;

@Injectable()
export class CasesService implements CaseMover {
  private readonly logger = new Logger(CasesService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly workflows: WorkflowsService,
    private readonly automation: AutomationService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Access                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Resolves a case only if this actor may see it. Every case endpoint goes
   * through here - and so do chat and documents - so guessing an id returns
   * 404 rather than data.
   *
   * The tenant is part of the query itself, so a case in another consultancy
   * is indistinguishable from one that does not exist, for every role.
   */
  async findAccessible(actor: AuthUser, caseId: string) {
    const [row] = await this.db
      .select({
        case: cases,
        clientUserId: clients.userId,
        clientName: clients.fullName,
        clientEmail: clients.email,
        clientPhone: clients.phone,
        clientLeadSource: clients.leadSource,
        assignedConsultantId: clients.assignedConsultantId,
        // The case's own consultant, here rather than in a query of its own.
        consultantName: users.fullName,
      })
      .from(cases)
      .innerJoin(clients, eq(clients.id, cases.clientId))
      .leftJoin(consultants, eq(consultants.id, cases.consultantId))
      .leftJoin(users, eq(users.id, consultants.userId))
      .where(and(eq(cases.id, caseId), eq(cases.tenantId, tenantOf(actor))))
      .limit(1);

    if (!row) throw new NotFoundException('Case not found.');

    switch (actor.role) {
      case 'manager':
        break;
      case 'consultant':
        if (
          !seesAll(actor) &&
          row.case.consultantId !== actor.consultantId &&
          row.assignedConsultantId !== actor.consultantId
        ) {
          throw new NotFoundException('Case not found.');
        }
        break;
      case 'client':
        if (row.clientUserId !== actor.id) throw new NotFoundException('Case not found.');
        break;
      default:
        throw new ForbiddenException('You do not have access to this case.');
    }

    return row;
  }

  /** Only staff may change a case; clients read theirs. */
  private assertCanEdit(actor: AuthUser): void {
    if (actor.role === 'client') {
      throw new ForbiddenException('Only your consultant can change the case.');
    }
  }

  /** Managers, and staff given the "approve gated stages" permission. */
  static canApprove(actor: AuthUser): boolean {
    return actor.role === 'manager' || (actor.role === 'consultant' && hasPermission(actor, 'case.approve'));
  }

  /* ---------------------------------------------------------------- */
  /* Read                                                              */
  /* ---------------------------------------------------------------- */

  async getDetail(actor: AuthUser, caseId: string): Promise<CaseDetail> {
    const row = await this.findAccessible(actor, caseId);
    const k = row.case;
    const facts = factsOf(k, row.clientLeadSource);
    const stages = await this.stagesFor(k);
    const current = stages.find((s) => s.key === k.currentStageKey) ?? null;

    const [history, progress, workflow, institution] = await Promise.all([
      this.history(caseId),
      this.stageProgress(caseId, k, current, true),
      this.workflows.caseWorkflow(k, facts),
      k.institutionId
        ? this.db.select({ name: institutions.name }).from(institutions).where(eq(institutions.id, k.institutionId)).limit(1)
        : Promise.resolve([] as { name: string }[]),
    ]);

    const daysInStage = daysSince(k.stageEnteredAt);
    const sla = k.stageSlaDays ?? STAGE_DEFINITIONS[k.currentStage as Stage].stuckAfterDays;

    return {
      id: k.id,
      reference: k.reference,
      clientId: k.clientId,
      clientName: row.clientName,
      clientEmail: row.clientEmail,
      clientPhone: row.clientPhone,
      clientUserId: row.clientUserId,
      consultantId: k.consultantId,
      consultantName: row.consultantName,
      targetCountry: k.targetCountry,
      targetUniversity: k.targetUniversity,
      targetProgram: k.targetProgram,
      studyLevel: k.studyLevel,
      visaType: k.visaType,
      intake: k.intake,
      currentStage: k.currentStage as Stage,
      currentStageKey: k.currentStageKey,
      currentStageName: k.currentStageName,
      status: k.status as CaseStatus,
      // Case notes are the office's working notes, never sent to the client.
      notes: actor.role === 'client' ? null : k.notes,
      stageEnteredAt: iso(k.stageEnteredAt),
      lastActivityAt: iso(k.lastActivityAt),
      createdAt: iso(k.createdAt),
      closedAt: k.closedAt ? iso(k.closedAt) : null,
      applicationDeadline: k.applicationDeadline,
      offerType: k.offerType as OfferType | null,
      offerConditions: k.offerConditions,
      offerDeadline: k.offerDeadline,
      visaAppointmentAt: k.visaAppointmentAt ? iso(k.visaAppointmentAt) : null,
      travelDate: k.travelDate,
      daysInStage,
      stageSlaDays: sla,
      isStuck: k.status === 'active' && k.currentStage !== 'closed' && daysInStage > sla,
      progress,
      history,
      workflow,
      institutionId: k.institutionId,
      institutionName: institution[0]?.name ?? null,
      tuitionFee: k.tuitionFee,
      tuitionCurrency: k.tuitionCurrency,
      scholarship: k.scholarship,
      courseStart: k.courseStart,
    };
  }

  async history(caseId: string): Promise<StageHistoryEntry[]> {
    const rows = await this.db
      .select({
        id: caseStageEvents.id,
        stage: caseStageEvents.stage,
        stageKey: caseStageEvents.stageKey,
        stageName: workflowStages.name,
        enteredAt: caseStageEvents.enteredAt,
        completedAt: caseStageEvents.completedAt,
        method: caseStageEvents.method,
        changedBy: caseStageEvents.changedBy,
        changedByName: users.fullName,
        note: caseStageEvents.note,
      })
      .from(caseStageEvents)
      .leftJoin(users, eq(users.id, caseStageEvents.changedBy))
      .leftJoin(
        workflowStages,
        and(eq(workflowStages.versionId, caseStageEvents.workflowVersionId), eq(workflowStages.key, caseStageEvents.stageKey)),
      )
      .where(eq(caseStageEvents.caseId, caseId))
      .orderBy(desc(caseStageEvents.enteredAt), desc(caseStageEvents.id));

    return rows.map((r) => ({
      id: r.id,
      stage: r.stage as Stage,
      stageKey: r.stageKey,
      stageName: r.stageName,
      enteredAt: iso(r.enteredAt),
      completedAt: r.completedAt ? iso(r.completedAt) : null,
      method: r.method as 'auto' | 'manual' | 'initial',
      changedBy: r.changedBy,
      changedByName: r.changedByName,
      note: r.note,
    }));
  }

  /**
   * Checklist state for the current stage, computed from the application's
   * live documents - and the student's own, which belong to no one
   * application: a passport uploaded once counts for every application it is
   * needed for. The stage's workflow decides which types it needs.
   */
  async stageProgress(caseId: string, k: Pick<CaseRow, 'currentStage' | 'currentStageKey' | 'tenantId'>, stage: StageRow | null, withLabels = false): Promise<StageProgress> {
    const category = (stage?.category ?? k.currentStage) as Stage;
    const required = stage?.requiredDocuments ?? STAGE_DEFINITIONS[category].requiredDocuments;
    const rows = required.length
      ? await this.db
          .select({ type: documents.typeKey, status: documents.status })
          .from(documents)
          .where(
            and(
              or(
                eq(documents.caseId, caseId),
                and(
                  isNull(documents.caseId),
                  sql`${documents.clientId} = (select k.client_id from cases k where k.id = ${caseId}::uuid)`,
                ),
              ),
              isNull(documents.deletedAt),
              isNull(documents.trashedAt),
            ),
          )
      : [];

    const progress = computeRequirementProgress(
      category,
      stage?.key ?? k.currentStageKey ?? category,
      required,
      rows.map((r) => ({ type: r.type, status: r.status as DocumentStatus })),
    );
    // A consultancy's own document types need their names; built-in ones the UI knows.
    const custom = withLabels ? progress.items.filter((i) => !BUILT_IN_TYPES.has(i.type)).map((i) => i.type) : [];
    if (custom.length) {
      const labels = await this.db
        .select({ key: documentTypes.key, label: documentTypes.label })
        .from(documentTypes)
        .where(and(eq(documentTypes.tenantId, k.tenantId), inArray(documentTypes.key, custom)));
      const byKey = new Map(labels.map((l) => [l.key, l.label]));
      for (const item of progress.items) {
        const label = byKey.get(item.type);
        if (label) item.label = label;
      }
    }
    return progress;
  }

  /* ---------------------------------------------------------------- */
  /* Create / update                                                   */
  /* ---------------------------------------------------------------- */

  async create(actor: AuthUser, input: CreateCaseInput) {
    this.assertCanEdit(actor);

    // Reuse the client scope: a consultant can only open a case for their own
    // client, and a manager for anyone.
    const [client] = await this.db
      .select({ id: clients.id, assignedConsultantId: clients.assignedConsultantId })
      .from(clients)
      .where(
        and(
          eq(clients.id, input.clientId),
          eq(clients.tenantId, tenantOf(actor)),
          actor.role === 'consultant' && !seesAll(actor)
            ? eq(clients.assignedConsultantId, actor.consultantId ?? NIL_UUID)
            : undefined,
        ),
      )
      .limit(1);

    if (!client) throw new NotFoundException('Client not found.');

    return this.createForClient(actor, {
      clientId: client.id,
      consultantId: client.assignedConsultantId,
      targetCountry: input.targetCountry,
      targetUniversity: input.targetUniversity ?? null,
      targetProgram: input.targetProgram ?? null,
      studyLevel: input.studyLevel ?? null,
      visaType: input.visaType ?? null,
      intake: input.intake ?? null,
      applicationDeadline: input.applicationDeadline ?? null,
      workflowId: input.workflowId,
    });
  }

  /**
   * Internal creation path, also used when a client is added with their first
   * application in one step. The application runs on the workflow asked
   * for, or the best match for its country, level and visa type, and starts
   * at that workflow's first stage that applies to it.
   */
  async createForClient(
    actor: AuthUser,
    input: {
      clientId: string;
      consultantId: string | null;
      targetCountry: string;
      targetUniversity?: string | null;
      targetProgram?: string | null;
      studyLevel?: string | null;
      visaType?: string | null;
      intake?: string | null;
      applicationDeadline?: string | null;
      workflowId?: string;
    },
  ) {
    const tenantId = tenantOf(actor);
    const reference = await this.nextReference(tenantId);
    const { versionId } = await this.workflows.versionForNewCase(
      tenantId,
      { country: input.targetCountry, studyLevel: input.studyLevel ?? null, visaType: input.visaType ?? null },
      input.workflowId,
    );
    const stages = await this.workflows.stagesOf(versionId);
    const facts = caseFacts({ ...input, targetCountry: input.targetCountry });
    const first = stages.find((s) => stageApplies(s, facts)) ?? stages[0]!;

    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(cases)
        .values({
          tenantId,
          reference,
          clientId: input.clientId,
          consultantId: input.consultantId,
          targetCountry: input.targetCountry,
          targetUniversity: input.targetUniversity ?? null,
          targetProgram: input.targetProgram ?? null,
          studyLevel: input.studyLevel ?? null,
          visaType: input.visaType ?? null,
          intake: input.intake ?? null,
          applicationDeadline: input.applicationDeadline ?? null,
          currentStage: first.category as Stage,
          workflowVersionId: versionId,
          currentStageKey: first.key,
          currentStageName: first.name,
          stageSlaDays: first.slaDays,
          status: 'active',
        })
        .returning();

      if (!row) throw new Error('Case insert returned no row');

      // An application makes a course-only student a study-abroad client.
      await tx
        .update(clients)
        .set({ programme: 'study_abroad', updatedAt: new Date() })
        .where(and(eq(clients.id, input.clientId), eq(clients.programme, 'course_only')));

      // Open the first stage window so the history is complete from day one.
      const [event] = await tx
        .insert(caseStageEvents)
        .values({
          tenantId,
          caseId: row.id,
          stage: first.category as Stage,
          stageKey: first.key,
          workflowVersionId: versionId,
          method: 'initial',
          changedBy: actor.id,
        })
        .returning({ id: caseStageEvents.id });

      return { ...row, eventId: event!.id };
    });

    await this.audit.record(actor, {
      action: 'case.created',
      entityType: 'case',
      entityId: created.id,
      caseId: created.id,
      clientId: created.clientId,
      metadata: { reference, targetCountry: input.targetCountry, workflowVersionId: versionId },
    });

    await this.automation.fire({ trigger: 'case_created', tenantId, caseId: created.id, actor, eventKey: `created:${created.id}` });
    await this.automation.stageEntered(created.id, first, created.eventId, actor);

    const { eventId: _eventId, ...row } = created;
    return row;
  }

  async update(actor: AuthUser, caseId: string, input: UpdateCaseInput) {
    this.assertCanEdit(actor);
    const row = await this.findAccessible(actor, caseId);

    const patch: Partial<typeof cases.$inferInsert> = {
      updatedAt: new Date(),
      lastActivityAt: new Date(),
    };
    if (input.targetUniversity !== undefined) patch.targetUniversity = input.targetUniversity;
    if (input.targetProgram !== undefined) patch.targetProgram = input.targetProgram;
    if (input.studyLevel !== undefined) patch.studyLevel = input.studyLevel;
    if (input.visaType !== undefined) patch.visaType = input.visaType;
    if (input.intake !== undefined) patch.intake = input.intake;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.applicationDeadline !== undefined) patch.applicationDeadline = input.applicationDeadline;
    if (input.offerType !== undefined) patch.offerType = input.offerType;
    if (input.offerConditions !== undefined) patch.offerConditions = input.offerConditions;
    if (input.offerDeadline !== undefined) patch.offerDeadline = input.offerDeadline;
    if (input.travelDate !== undefined) patch.travelDate = input.travelDate;
    if (input.visaAppointmentAt !== undefined) {
      patch.visaAppointmentAt = input.visaAppointmentAt ? new Date(input.visaAppointmentAt) : null;
    }

    await this.db
      .update(cases)
      .set(patch)
      .where(and(eq(cases.id, caseId), eq(cases.tenantId, row.case.tenantId)));

    const changed = Object.keys(patch).filter((k) => !['updatedAt', 'lastActivityAt'].includes(k));
    await this.audit.record(actor, {
      action: changed.length === 1 && changed[0] === 'notes' ? 'case.note_added' : 'case.updated',
      entityType: 'case',
      entityId: caseId,
      caseId,
      clientId: row.case.clientId,
      metadata: { changed },
    });

    return this.getDetail(actor, caseId);
  }

  /* ---------------------------------------------------------------- */
  /* Stage transitions                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * Manual move. Always available to staff, including moving a case
   * backwards or skipping ahead - but anything other than a simple step
   * forward has to carry a written reason, which is stored on the history row
   * and in the audit log. A workflow can add two gates: a stage only
   * managers may move applications into or out of, and a stage that must be
   * signed off before it is left going forward.
   */
  async changeStage(actor: AuthUser, caseId: string, input: ChangeStageInput): Promise<CaseDetail> {
    this.assertCanEdit(actor);
    const row = await this.findAccessible(actor, caseId);
    const k = row.case;

    if (k.status !== 'active') {
      throw new BadRequestException(
        `This case is ${k.status.replace('_', ' ')}. Set it back to active before moving it.`,
      );
    }

    const stages = await this.stagesFor(k);
    const facts = factsOf(k, row.clientLeadSource);
    const fromKey = k.currentStageKey ?? stages.find((s) => s.category === k.currentStage)?.key ?? '';
    const toKey = input.stageKey ?? (input.stage ? this.keyForCategory(stages, input.stage, facts) : '');
    const from = stages.find((s) => s.key === fromKey);
    const to = stages.find((s) => s.key === toKey);

    const check = checkWorkflowTransition(stages, fromKey, toKey, facts);
    if (!check.allowed) throw new BadRequestException(check.message);

    if (check.requiresReason && !input.reason?.trim()) {
      throw new BadRequestException({
        message:
          check.kind === 'back'
            ? 'Moving a case backwards needs a reason.'
            : 'Skipping ahead needs a reason.',
        fieldErrors: { reason: 'Explain why, so the history makes sense later.' },
      });
    }

    const approver = CasesService.canApprove(actor);
    for (const gate of [from, to]) {
      if (gate?.movableBy === 'managers' && !approver) {
        throw new ForbiddenException(`Only managers can move applications ${gate === from ? 'out of' : 'into'} “${gate.name}”.`);
      }
    }

    let implicitApproval = false;
    if (from?.approvalRequired && !k.stageApprovedAt && check.kind !== 'back') {
      if (!approver) {
        throw new ForbiddenException(`“${from.name}” has to be approved before the application moves on. Ask a manager to approve it.`);
      }
      implicitApproval = true;
    }

    if (implicitApproval) {
      await this.audit.record(actor, {
        action: 'case.stage_approved',
        entityType: 'case',
        entityId: caseId,
        caseId,
        clientId: k.clientId,
        metadata: { stage: fromKey, implicit: true },
      });
    }

    const eventId = await this.applyStage(k, fromKey, to!, {
      method: 'manual',
      actorId: actor.id,
      note: input.reason?.trim() || null,
    });

    await this.audit.record(actor, {
      action: 'case.stage_overridden',
      entityType: 'case',
      entityId: caseId,
      caseId,
      clientId: k.clientId,
      metadata: { from: fromKey, to: toKey, kind: check.kind, reason: input.reason ?? null },
    });

    await this.afterStageChange(k, from ?? null, to!, eventId, actor, row.clientUserId, 0);

    return this.getDetail(actor, caseId);
  }

  /** Sign off the current stage. If its documents are done, it moves on. */
  async approveStage(actor: AuthUser, caseId: string, note?: string): Promise<CaseDetail> {
    this.assertCanEdit(actor);
    if (!CasesService.canApprove(actor)) {
      throw new ForbiddenException('Only managers, or staff allowed to approve stages, can sign off a stage.');
    }
    const row = await this.findAccessible(actor, caseId);
    const k = row.case;
    const stage = (await this.stagesFor(k)).find((s) => s.key === k.currentStageKey);
    if (!stage?.approvalRequired) throw new BadRequestException('This stage does not need approval.');
    if (k.stageApprovedAt) throw new BadRequestException('This stage is already approved.');

    await this.db
      .update(cases)
      .set({ stageApprovedAt: new Date(), stageApprovedBy: actor.id, lastActivityAt: new Date(), updatedAt: new Date() })
      .where(eq(cases.id, caseId));
    await this.audit.record(actor, {
      action: 'case.stage_approved',
      entityType: 'case',
      entityId: caseId,
      caseId,
      clientId: k.clientId,
      metadata: { stage: stage.key, stageName: stage.name, note: note ?? null },
    });

    const [consultant] = k.consultantId
      ? await this.db.select({ userId: consultants.userId }).from(consultants).where(eq(consultants.id, k.consultantId)).limit(1)
      : [];
    if (consultant && consultant.userId !== actor.id) {
      await this.notifications.push({
        userId: consultant.userId,
        type: 'workflow_alert',
        title: `${row.clientName}: “${stage.name}” approved`,
        body: note ?? `${actor.fullName} signed it off.`,
        link: `/desk/cases/${caseId}`,
        caseId,
      });
    }

    await this.evaluateAutoAdvance(caseId, actor);
    return this.getDetail(actor, caseId);
  }

  /**
   * Move an application to another workflow (or a newer version of its
   * own). It lands on the stage with the same key, else the first of the
   * same category, else the first that applies - or where it is told to.
   */
  async changeWorkflow(actor: AuthUser, caseId: string, input: ChangeCaseWorkflowInput): Promise<CaseDetail> {
    this.assertCanEdit(actor);
    const row = await this.findAccessible(actor, caseId);
    const k = row.case;
    const [target] = await this.db
      .select({ id: workflowVersions.id, version: workflowVersions.version, templateName: workflowTemplates.name, status: workflowVersions.status })
      .from(workflowVersions)
      .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.templateId))
      .where(and(eq(workflowVersions.id, input.versionId), eq(workflowVersions.tenantId, k.tenantId), isNull(workflowTemplates.archivedAt)))
      .limit(1);
    if (!target || target.status !== 'published') {
      throw new BadRequestException('Applications can only move to the current version of an active workflow.');
    }
    if (target.id === k.workflowVersionId) throw new BadRequestException('It is already on that version.');

    const stages = await this.workflows.stagesOf(target.id);
    const facts = factsOf(k, row.clientLeadSource);
    const landing =
      (input.stageKey ? stages.find((s) => s.key === input.stageKey) : undefined) ??
      stages.find((s) => s.key === k.currentStageKey) ??
      stages.find((s) => s.category === k.currentStage && stageApplies(s, facts)) ??
      stages.find((s) => stageApplies(s, facts)) ??
      stages[0]!;
    if (input.stageKey && landing.key !== input.stageKey) throw new BadRequestException('That workflow has no such stage.');

    const fromStages = await this.stagesFor(k);
    const from = fromStages.find((s) => s.key === k.currentStageKey) ?? null;
    const reason = input.reason.trim();
    const eventId = await this.applyStage(
      k,
      k.currentStageKey ?? '',
      landing,
      { method: 'manual', actorId: actor.id, note: `Moved to ${target.templateName} v${target.version}: ${reason}` },
      target.id,
    );
    await this.audit.record(actor, {
      action: 'case.workflow_changed',
      entityType: 'case',
      entityId: caseId,
      caseId,
      clientId: k.clientId,
      metadata: { fromVersionId: k.workflowVersionId, toVersionId: target.id, workflow: target.templateName, version: target.version, stage: landing.key, reason },
    });
    if (landing.key !== k.currentStageKey) {
      await this.afterStageChange(k, from, landing, eventId, actor, row.clientUserId, 0);
    }
    return this.getDetail(actor, caseId);
  }

  /**
   * Open applications on older versions move to the new one in a single
   * statement, keeping their place: same stage key, else the first stage of
   * the same category, else the first stage. The time already spent in the
   * stage counts on. Each move is in the audit log.
   */
  async upgradeToVersion(actor: AuthUser, fromVersionIds: string[], toVersionId: string): Promise<number> {
    const moved = await this.db
      .update(cases)
      .set({
        workflowVersionId: toVersionId,
        currentStageKey: sql`coalesce(
          (select s.key from workflow_stages s where s.version_id = ${toVersionId}::uuid and s.key = "cases"."current_stage_key"),
          (select s.key from workflow_stages s where s.version_id = ${toVersionId}::uuid and s.category = "cases"."current_stage" order by s.position limit 1),
          (select s.key from workflow_stages s where s.version_id = ${toVersionId}::uuid order by s.position limit 1)
        )`,
        stageApprovedAt: null,
        stageApprovedBy: null,
        updatedAt: new Date(),
      })
      .where(and(eq(cases.tenantId, tenantOf(actor)), inArray(cases.workflowVersionId, fromVersionIds), eq(cases.status, 'active')))
      .returning({ id: cases.id, clientId: cases.clientId, stageKey: cases.currentStageKey });
    // The open history row follows, so time in stage is read against the new version.
    if (moved.length) {
      await this.db
        .update(caseStageEvents)
        .set({ workflowVersionId: toVersionId, stageKey: sql`(select c.current_stage_key from cases c where c.id = "case_stage_events"."case_id")` })
        .where(and(inArray(caseStageEvents.caseId, moved.map((m) => m.id)), isNull(caseStageEvents.completedAt)));
    }
    for (const m of moved) {
      await this.audit.record(actor, {
        action: 'case.workflow_changed',
        entityType: 'case',
        entityId: m.id,
        caseId: m.id,
        clientId: m.clientId,
        metadata: { toVersionId, stage: m.stageKey, upgrade: true },
      });
    }
    return moved.length;
  }

  async changeStatus(
    actor: AuthUser,
    caseId: string,
    input: ChangeCaseStatusInput,
  ): Promise<CaseDetail> {
    this.assertCanEdit(actor);
    const row = await this.findAccessible(actor, caseId);
    const from = row.case.status as CaseStatus;

    if (from === input.status) return this.getDetail(actor, caseId);

    await this.setStatus(caseId, input.status);

    await this.audit.record(actor, {
      action: 'case.status_changed',
      entityType: 'case',
      entityId: caseId,
      caseId,
      clientId: row.case.clientId,
      metadata: { from, to: input.status, reason: input.reason ?? null },
    });

    await this.automation.fire({
      trigger: 'status_changed',
      tenantId: row.case.tenantId,
      caseId,
      actor,
      eventKey: `status:${caseId}:${Date.now()}:${input.status}`,
    });

    return this.getDetail(actor, caseId);
  }

  private async setStatus(caseId: string, status: CaseStatus): Promise<void> {
    await this.db
      .update(cases)
      .set({
        status,
        closedAt: status === 'approved' || status === 'rejected' || status === 'withdrawn' ? new Date() : null,
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(cases.id, caseId));
  }

  /**
   * Auto-advancement.
   *
   * Called after anything that could satisfy a checklist - a document being
   * approved, a stage being signed off. A stage with no required documents
   * never auto-advances: "Application Submitted" moves when a human says it
   * did, not because there was nothing to collect. That rule also bounds the
   * cascade, so this cannot run away down the pipeline. A workflow can also
   * switch auto-advance off for a stage, or require sign-off first.
   *
   * Returns the stages it moved through (their categories), newest last.
   */
  async evaluateAutoAdvance(caseId: string, actor: AuthUser | null): Promise<Stage[]> {
    const moved: Stage[] = [];
    let last: { stage: StageRow; clientUserId: string | null } | null = null;

    try {
      for (let guard = 0; guard < 10; guard++) {
        const [k] = await this.db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
        if (!k || k.status !== 'active') break;

        const stages = await this.stagesFor(k);
        const stage = stages.find((s) => s.key === k.currentStageKey);
        if (!stage || !stage.autoAdvance) break;
        if (stage.approvalRequired && !k.stageApprovedAt) break;
        const progress = await this.stageProgress(caseId, k, stage);
        if (!progress.satisfied) break;

        const [client] = await this.db
          .select({ userId: clients.userId, leadSource: clients.leadSource })
          .from(clients)
          .where(eq(clients.id, k.clientId))
          .limit(1);
        const nextKey = nextStageKey(stages, stage.key, factsOf(k, client?.leadSource ?? null));
        const next = stages.find((s) => s.key === nextKey);
        if (!next) break;

        const eventId = await this.applyStage(k, stage.key, next, {
          method: 'auto',
          actorId: actor?.id ?? null,
          note: `All ${progress.required} required documents verified.`,
        });

        await this.audit.record(actor, {
          action: 'case.stage_advanced',
          entityType: 'case',
          // There may be no actor (a system trigger); the case says whose it is.
          tenantId: k.tenantId,
          entityId: caseId,
          caseId,
          clientId: k.clientId,
          metadata: { from: stage.key, to: next.key, trigger: 'checklist_satisfied' },
        });

        moved.push(next.category as Stage);
        // The student hears once, about where it ended up - not every step of a cascade.
        await this.afterStageChange(k, stage, next, eventId, actor, client?.userId ?? null, 0, false);
        last = { stage: next, clientUserId: client?.userId ?? null };
      }
      if (last && last.stage.notifyStudent) await this.notifyStageChange(last.clientUserId, caseId, last.stage);
    } catch (err) {
      // Auto-advancement is a convenience layered on top of the real action.
      // If it fails, the document verification that triggered it still stands.
      this.logger.error(`Auto-advance failed for case ${caseId}`, err as Error);
    }

    return moved;
  }

  /* ---------------------------------------------------------------- */
  /* Moves made by automations                                         */
  /* ---------------------------------------------------------------- */

  async moveByAutomation(caseId: string, stageKey: string, ruleName: string, depth: number): Promise<string> {
    const [k] = await this.db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    if (!k) throw new Error('The application no longer exists.');
    if (k.status !== 'active') return `Not moved: the application is ${k.status.replace('_', ' ')}.`;
    if (k.currentStageKey === stageKey) return 'Already at that stage.';
    const stages = await this.stagesFor(k);
    const to = stages.find((s) => s.key === stageKey);
    if (!to) throw new Error(`Its workflow has no stage “${stageKey}”.`);
    const from = stages.find((s) => s.key === k.currentStageKey) ?? null;
    const [client] = await this.db.select({ userId: clients.userId }).from(clients).where(eq(clients.id, k.clientId)).limit(1);
    const eventId = await this.applyStage(k, k.currentStageKey ?? '', to, { method: 'auto', actorId: null, note: `Moved by automation “${ruleName}”.` });
    await this.audit.record(null, {
      action: 'case.stage_advanced',
      entityType: 'case',
      tenantId: k.tenantId,
      entityId: caseId,
      caseId,
      clientId: k.clientId,
      metadata: { from: k.currentStageKey, to: to.key, trigger: 'automation', automation: ruleName },
    });
    await this.afterStageChange(k, from, to, eventId, null, client?.userId ?? null, depth);
    return `Moved to “${to.name}”.`;
  }

  async setStatusByAutomation(caseId: string, status: 'active' | 'on_hold' | 'withdrawn', ruleName: string): Promise<string> {
    const [k] = await this.db.select({ status: cases.status, tenantId: cases.tenantId, clientId: cases.clientId }).from(cases).where(eq(cases.id, caseId)).limit(1);
    if (!k) throw new Error('The application no longer exists.');
    if (k.status === status) return `Already ${status.replace('_', ' ')}.`;
    if (k.status === 'approved' || k.status === 'rejected') return `Not changed: the visa decision (${k.status}) is recorded by a person.`;
    await this.setStatus(caseId, status);
    await this.audit.record(null, {
      action: 'case.status_changed',
      entityType: 'case',
      tenantId: k.tenantId,
      entityId: caseId,
      caseId,
      clientId: k.clientId,
      metadata: { from: k.status, to: status, automation: ruleName },
    });
    return `Status set to ${status.replace('_', ' ')}.`;
  }

  /* ---------------------------------------------------------------- */
  /* The one place a stage changes                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Closes the open history row, opens the new one and moves the case, all
   * in a single transaction so the history can never disagree with the case.
   * Returns the new history row's id.
   */
  private async applyStage(
    k: Pick<CaseRow, 'id' | 'tenantId' | 'workflowVersionId'>,
    _fromKey: string,
    to: StageRow,
    opts: { method: 'auto' | 'manual'; actorId: string | null; note: string | null },
    versionId: string | null = k.workflowVersionId,
  ): Promise<string> {
    const now = new Date();
    const category = to.category as Stage;

    return this.db.transaction(async (tx) => {
      await tx
        .update(caseStageEvents)
        .set({ completedAt: now })
        .where(and(eq(caseStageEvents.caseId, k.id), isNull(caseStageEvents.completedAt)));

      const [event] = await tx
        .insert(caseStageEvents)
        .values({
          tenantId: k.tenantId,
          caseId: k.id,
          stage: category,
          stageKey: to.key,
          workflowVersionId: versionId,
          enteredAt: now,
          method: opts.method,
          changedBy: opts.actorId,
          note: opts.note,
        })
        .returning({ id: caseStageEvents.id });

      await tx
        .update(cases)
        .set({
          currentStage: category,
          workflowVersionId: versionId,
          currentStageKey: to.key,
          currentStageName: to.name,
          stageSlaDays: to.slaDays,
          stageApprovedAt: null,
          stageApprovedBy: null,
          stageEnteredAt: now,
          lastActivityAt: now,
          updatedAt: now,
          ...(category === 'closed' ? { closedAt: now } : {}),
        })
        .where(eq(cases.id, k.id));

      return event!.id;
    });
  }

  /**
   * Everything that follows a move: the student hears about it (unless the
   * stage says not to), automations on leaving and entering run, and the
   * stage's own tasks, fees and messages are created.
   */
  private async afterStageChange(
    k: Pick<CaseRow, 'id' | 'tenantId'>,
    from: StageRow | null,
    to: StageRow,
    eventId: string,
    actor: AuthUser | null,
    clientUserId: string | null,
    depth: number,
    notifyStudent = true,
  ): Promise<void> {
    if (to.notifyStudent && notifyStudent) await this.notifyStageChange(clientUserId, k.id, to);
    if (from) {
      await this.automation.fire({ trigger: 'stage_left', tenantId: k.tenantId, caseId: k.id, actor, stageKey: from.key, eventKey: `left:${eventId}`, depth });
    }
    await this.automation.stageEntered(k.id, to, eventId, actor, depth);
  }

  private async notifyStageChange(clientUserId: string | null, caseId: string, stage: StageRow): Promise<void> {
    if (!clientUserId) return;
    await this.notifications.push({
      userId: clientUserId,
      type: 'stage_changed',
      title: `Your application moved to ${stage.clientLabel}`,
      body: stage.clientDescription,
      link: '/portal',
      caseId,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  /** The stages of the application's workflow version. */
  private async stagesFor(k: Pick<CaseRow, 'workflowVersionId' | 'tenantId'>): Promise<StageRow[]> {
    if (k.workflowVersionId) return this.workflows.stagesOf(k.workflowVersionId);
    const { versionId } = await this.workflows.versionForNewCase(k.tenantId, { country: null, studyLevel: null, visaType: null });
    return this.workflows.stagesOf(versionId);
  }

  /** A category asked for by name: its first stage that applies to this application. */
  private keyForCategory(stages: StageRow[], stage: Stage, facts: ConditionFacts): string {
    return (
      stages.find((s) => s.key === stage)?.key ??
      stages.find((s) => s.category === stage && stageApplies(s, facts))?.key ??
      stages.find((s) => s.category === stage)?.key ??
      stage
    );
  }

  async touch(caseId: string): Promise<void> {
    await this.db
      .update(cases)
      .set({ lastActivityAt: new Date(), updatedAt: new Date() })
      .where(eq(cases.id, caseId));
  }

  /**
   * Human-readable case reference, e.g. APP-2026-0042. Numbered per
   * consultancy, so each one's references run from 0001 regardless of how busy
   * the rest of the platform is.
   * Counting is fine at this scale; swap for a Postgres sequence per year if
   * case creation ever becomes concurrent enough to collide repeatedly.
   */
  private async nextReference(tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `APP-${year}-`;

    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(cases)
      .where(and(eq(cases.tenantId, tenantId), sql`${cases.reference} like ${prefix + '%'}`));

    const base = (row?.n ?? 0) + 1;
    for (let attempt = 0; attempt < 25; attempt++) {
      const candidate = `${prefix}${String(base + attempt).padStart(4, '0')}`;
      const [clash] = await this.db
        .select({ id: cases.id })
        .from(cases)
        .where(and(eq(cases.tenantId, tenantId), eq(cases.reference, candidate)))
        .limit(1);
      if (!clash) return candidate;
    }
    return `${prefix}${Date.now().toString().slice(-6)}`;
  }
}

function factsOf(k: Pick<CaseRow, 'targetCountry' | 'studyLevel' | 'visaType' | 'intake' | 'targetUniversity' | 'status'>, leadSource: string | null): ConditionFacts {
  return caseFacts({ ...k, leadSource });
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function daysSince(value: Date | string): number {
  const d = value instanceof Date ? value : new Date(value);
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}
