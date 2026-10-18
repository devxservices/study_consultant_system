import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  STAGE_ORDER,
  clawbackSchema,
  commissionAmount,
  commissionSettingsSchema,
  commissionSplitSchema,
  commissionStage,
  confirmCommissionSchema,
  formatMoney,
  manualCommissionSchema,
  matchRule,
  payIncentiveSchema,
  percentToBp,
  tierRateBp,
  bpToPercent,
  type AuthUser,
  type ClawbackInput,
  type CommissionKind,
  type CommissionSettingsInput,
  type CommissionSettingsView,
  type CommissionSplitInput,
  type CommissionSplitView,
  type CommissionStatus,
  type CommissionTotals,
  type CommissionView,
  type CommissionsOverview,
  type CommissionsQuery,
  type ConfirmCommissionInput,
  type Currency,
  type ManualCommissionInput,
  type Paginated,
  type PayIncentiveInput,
  type Stage,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import {
  cases,
  clients,
  commissionAgreements,
  commissionClaims,
  commissionRules,
  commissionSettings,
  commissionSplits,
  commissions,
  consultants,
  institutions,
  users,
} from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RemindersService } from '../reminders/reminders.service';
import { AutomationService, type AutomationEvent } from '../workflows/automation.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { staffCan } from '../auth/permissions';
import { addDays, iso, isoOrNull, page, today, withDocumentNumber } from '../common/db-helpers';
import { permissionHolders } from '../common/permission-holders';
import { assertMoneyAccount, liveEntryFor, postEntry, reverseEntry } from '../finance/journal';
import { LedgerService } from '../finance/ledger.service';
import { CasesService } from '../cases/cases.service';
import { InstitutionsService } from './institutions.service';

type CommissionRow = typeof commissions.$inferSelect;

/** Received so far on a commission: its allocations from receipts that stand. */
const receivedSql = sql<string>`coalesce((
  select sum(a.amount) from receipt_allocations a
  join institution_receipts r on r.id = a.receipt_id
  where a.commission_id = ${commissions.id} and r.voided_at is null
), 0)`;
const fxSql = sql<string>`coalesce((
  select sum(a.fx_difference) from receipt_allocations a
  join institution_receipts r on r.id = a.receipt_id
  where a.commission_id = ${commissions.id} and r.voided_at is null
), 0)`;

const OPEN: CommissionStatus[] = ['confirmed', 'claimed', 'disputed'];

const addYears = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCFullYear(x.getUTCFullYear() + n);
  return x.toISOString().slice(0, 10);
};

/**
 * Commissions: worked out when an application reaches its agreement's
 * trigger step, confirmed (and booked) when the student enrols, claimed,
 * received - or cancelled, disputed, written off or clawed back, each with
 * its reason and, where money is involved, its journal entry.
 */
/** What happened to a commission - for modules that share in it. Amounts in the commission's currency. */
export type CommissionEvent =
  | { type: 'confirmed'; tenantId: string; commissionId: string; on: string; actor: AuthUser | null }
  | { type: 'received'; tenantId: string; commissionId: string; allocationId: string; receiptId: string; amount: number; fxRate: number | null; on: string; actor: AuthUser | null }
  | { type: 'receipt_voided'; tenantId: string; commissionId: string; allocationId: string; receiptId: string; amount: number; on: string; actor: AuthUser | null }
  | { type: 'clawed_back'; tenantId: string; commissionId: string; amount: number; on: string; actor: AuthUser | null }
  | { type: 'cancelled'; tenantId: string; commissionId: string; on: string; actor: AuthUser | null };

@Injectable()
export class CommissionsService implements OnModuleInit {
  private readonly logger = new Logger(CommissionsService.name);
  private readonly commissionListeners: ((e: CommissionEvent) => Promise<void>)[] = [];

  /** Hears what happens to commissions after it is recorded (partner shares). A listener that fails never undoes it. */
  onCommission(fn: (e: CommissionEvent) => Promise<void>): void {
    this.commissionListeners.push(fn);
  }

  async emitCommission(e: CommissionEvent): Promise<void> {
    for (const fn of this.commissionListeners) {
      try {
        await fn(e);
      } catch (err) {
        this.logger.error(`A commission listener failed on ${e.type} ${e.commissionId}`, err as Error);
      }
    }
  }

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly reminders: RemindersService,
    private readonly automation: AutomationService,
    private readonly institutions: InstitutionsService,
    private readonly ledger: LedgerService,
    private readonly cases: CasesService,
  ) {}

  onModuleInit(): void {
    this.automation.listen((e) => this.onCaseEvent(e));
    this.reminders.register('commission-follow-ups', () => this.followUps());
  }

  private assertView(actor: AuthUser): void {
    if (!staffCan(actor, 'commission.view')) throw new ForbiddenException('You do not have permission to see commissions.');
  }

  private assertManage(actor: AuthUser): void {
    if (!staffCan(actor, 'commission.manage')) throw new ForbiddenException('You do not have permission to manage commissions.');
  }

  /* ---------------------------------------------------------------- */
  /* Reading                                                           */
  /* ---------------------------------------------------------------- */

  async list(actor: AuthUser, q: CommissionsQuery): Promise<Paginated<CommissionView>> {
    this.assertView(actor);
    const tenantId = tenantOf(actor);
    const conds: (SQL | undefined)[] = [eq(commissions.tenantId, tenantId)];
    if (q.institutionId) conds.push(eq(commissions.institutionId, q.institutionId));
    if (q.caseId) conds.push(eq(commissions.caseId, q.caseId));
    if (q.q) conds.push(or(ilike(clients.fullName, `%${q.q}%`), ilike(commissions.number, `%${q.q}%`), ilike(institutions.name, `%${q.q}%`)));
    const received = sql`${receivedSql}`;
    switch (q.view) {
      case 'expected':
        conds.push(eq(commissions.status, 'expected'));
        break;
      case 'to_claim':
        conds.push(eq(commissions.status, 'confirmed'), isNull(commissions.claimId), sql`${received} < ${commissions.amount}`);
        break;
      case 'claimed':
        conds.push(inArray(commissions.status, ['claimed', 'confirmed']), sql`${commissions.claimId} is not null`, sql`${received} < ${commissions.amount}`);
        break;
      case 'received':
        conds.push(inArray(commissions.status, ['confirmed', 'claimed']), sql`${received} >= ${commissions.amount}`);
        break;
      case 'problems':
        conds.push(inArray(commissions.status, ['disputed', 'written_off', 'clawed_back']));
        break;
    }
    const where = and(...conds);
    const [[count], ids] = await Promise.all([
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(commissions)
        .innerJoin(institutions, eq(institutions.id, commissions.institutionId))
        .leftJoin(clients, eq(clients.id, commissions.clientId))
        .where(where),
      this.db
        .select({ id: commissions.id })
        .from(commissions)
        .innerJoin(institutions, eq(institutions.id, commissions.institutionId))
        .leftJoin(clients, eq(clients.id, commissions.clientId))
        .where(where)
        .orderBy(sql`${commissions.expectedOn} asc nulls last`, desc(commissions.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
    ]);
    return page(await this.views(ids.map((i) => i.id)), count?.n ?? 0, q.page, q.pageSize);
  }

  async get(actor: AuthUser, id: string): Promise<CommissionView> {
    this.assertView(actor);
    await this.find(tenantOf(actor), id);
    return (await this.views([id]))[0]!;
  }

  /** Commissions on one application - for its page. */
  async forCase(actor: AuthUser, caseId: string): Promise<CommissionView[]> {
    this.assertView(actor);
    await this.cases.findAccessible(actor, caseId);
    const rows = await this.db.select({ id: commissions.id }).from(commissions).where(and(eq(commissions.tenantId, tenantOf(actor)), eq(commissions.caseId, caseId))).orderBy(asc(commissions.yearNo));
    return this.views(rows.map((r) => r.id));
  }

  /** Full views, in the order given. */
  async views(ids: string[]): Promise<CommissionView[]> {
    if (!ids.length) return [];
    const consultantUser = alias(users, 'cm_consultant_user');
    const rows = await this.db
      .select({
        c: commissions,
        received: receivedSql,
        fx: fxSql,
        caseReference: cases.reference,
        clientName: clients.fullName,
        consultantName: consultantUser.fullName,
        institutionName: institutions.name,
        agreementTitle: commissionAgreements.title,
        claimNumber: commissionClaims.number,
      })
      .from(commissions)
      .innerJoin(institutions, eq(institutions.id, commissions.institutionId))
      .leftJoin(cases, eq(cases.id, commissions.caseId))
      .leftJoin(clients, eq(clients.id, commissions.clientId))
      .leftJoin(consultants, eq(consultants.id, cases.consultantId))
      .leftJoin(consultantUser, eq(consultantUser.id, consultants.userId))
      .leftJoin(commissionAgreements, eq(commissionAgreements.id, commissions.agreementId))
      .leftJoin(commissionClaims, eq(commissionClaims.id, commissions.claimId))
      .where(inArray(commissions.id, ids));
    const splitRows = await this.db
      .select({ s: commissionSplits, userName: users.fullName })
      .from(commissionSplits)
      .innerJoin(users, eq(users.id, commissionSplits.userId))
      .where(inArray(commissionSplits.commissionId, ids));
    const byId = new Map(rows.map((r) => [r.c.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => {
        const received = Number(r.received);
        const status = r.c.status as CommissionStatus;
        const stage = commissionStage(status, r.c.amount, received);
        const fullyReceived = stage === 'received';
        return {
          id: r.c.id,
          number: r.c.number,
          kind: r.c.kind as CommissionKind,
          caseId: r.c.caseId,
          caseReference: r.caseReference,
          clientId: r.c.clientId,
          clientName: r.clientName,
          consultantName: r.consultantName,
          institutionId: r.c.institutionId,
          institutionName: r.institutionName,
          agreementId: r.c.agreementId,
          agreementTitle: r.agreementTitle,
          ruleName: (r.c.ruleSnapshot?.name as string | undefined) ?? null,
          yearNo: r.c.yearNo,
          intake: r.c.intake,
          tuition: r.c.tuition,
          rateBp: r.c.rateBp,
          amount: r.c.amount,
          currency: r.c.currency as Currency,
          received,
          outstanding: OPEN.includes(status) ? Math.max(0, r.c.amount - received) : 0,
          status,
          stage,
          expectedOn: r.c.expectedOn,
          claimableOn: r.c.claimableOn,
          retentionUntil: r.c.retentionUntil,
          confirmedAt: isoOrNull(r.c.confirmedAt),
          claimId: r.c.claimId,
          claimNumber: r.claimNumber,
          note: r.c.note,
          fxDifference: Number(r.fx),
          createdAt: iso(r.c.createdAt),
          splits: splitRows
            .filter((s) => s.s.commissionId === r.c.id)
            .map(
              (s): CommissionSplitView => ({
                id: s.s.id,
                userId: s.s.userId,
                userName: s.userName,
                shareBp: s.s.shareBp,
                amount: Math.round((r.c.amount * s.s.shareBp) / 10_000),
                currency: r.c.currency as Currency,
                payable: fullyReceived && !s.s.paidOn,
                paidOn: s.s.paidOn,
                paidAmount: s.s.paidAmount,
              }),
            ),
        };
      });
  }

  /* ---------------------------------------------------------------- */
  /* Working them out                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Application events. Reaching the trigger step makes the commission
   * expected; withdrawing or a refused visa cancels what was only expected,
   * and warns about anything already earned that may be clawed back.
   */
  private async onCaseEvent(e: AutomationEvent): Promise<void> {
    if (e.trigger === 'stage_entered' || e.trigger === 'case_created') {
      await this.workOut(e.tenantId, e.caseId, null, false);
    } else if (e.trigger === 'status_changed') {
      const [k] = await this.db.select({ status: cases.status, reference: cases.reference }).from(cases).where(eq(cases.id, e.caseId)).limit(1);
      if (!k || (k.status !== 'withdrawn' && k.status !== 'rejected')) return;
      const why = k.status === 'withdrawn' ? 'The application was withdrawn.' : 'The visa was refused.';
      const expected = await this.db
        .update(commissions)
        .set({ status: 'cancelled', note: why, updatedAt: new Date() })
        .where(and(eq(commissions.caseId, e.caseId), eq(commissions.status, 'expected')))
        .returning({ id: commissions.id, number: commissions.number });
      for (const c of expected) {
        await this.audit.record(e.actor, { tenantId: e.tenantId, action: 'commission.status_changed', entityType: 'commission', entityId: c.id, caseId: e.caseId, metadata: { number: c.number, to: 'cancelled', reason: why } });
      }
      const earned = await this.db
        .select({ id: commissions.id, number: commissions.number, retentionUntil: commissions.retentionUntil })
        .from(commissions)
        .where(and(eq(commissions.caseId, e.caseId), inArray(commissions.status, OPEN)));
      const atRisk = earned.filter((c) => c.retentionUntil && c.retentionUntil >= today());
      if (atRisk.length) {
        const managers = await permissionHolders(this.db, e.tenantId, 'commission.manage');
        await this.notifications.pushMany(managers, {
          type: 'commission_due',
          title: `${k.reference}: commission may be clawed back`,
          body: `${why} It is inside the retention period of ${atRisk.map((c) => c.number).join(', ')}.`,
          link: `/overview/commissions/list?view=all&caseId=${e.caseId}`,
        });
      }
    }
  }

  /**
   * Works out the expected commissions for an application from the
   * agreement in force with its institution. Automatic when the application
   * reaches the rule's trigger step; `force` (staff asking for it) skips
   * that wait and explains, rather than ignores, anything missing.
   */
  async workOut(tenantId: string, caseId: string, actor: AuthUser | null, force: boolean): Promise<number> {
    const [k] = await this.db
      .select({ c: cases, leadSource: clients.leadSource, consultantUserId: consultants.userId })
      .from(cases)
      .innerJoin(clients, eq(clients.id, cases.clientId))
      .leftJoin(consultants, eq(consultants.id, cases.consultantId))
      .where(and(eq(cases.id, caseId), eq(cases.tenantId, tenantId)))
      .limit(1);
    if (!k) return 0;
    const fail = (message: string) => {
      if (force) throw new BadRequestException(message);
      return 0;
    };
    const c = k.c;
    if (!c.institutionId) return fail('Choose the institution on the application first.');
    if (c.status === 'withdrawn' || c.status === 'rejected') return fail('The application is closed.');
    const found = await this.institutions.agreementOn(tenantId, c.institutionId, today());
    if (!found) return fail('There is no agreement in force with this institution.');
    const facts = {
      targetCountry: c.targetCountry,
      studyLevel: c.studyLevel,
      visaType: c.visaType,
      intake: c.intake,
      targetUniversity: c.targetUniversity,
      leadSource: k.leadSource,
    };
    const rule = matchRule(found.rules, facts);
    if (!rule) return fail('None of the agreement’s rules covers this application.');
    if (!force && STAGE_ORDER.indexOf(c.currentStage as Stage) < STAGE_ORDER.indexOf(rule.triggerStage as Stage)) return 0;
    const net = c.tuitionFee === null ? null : Math.max(0, c.tuitionFee - (c.scholarship ?? 0));
    if (rule.basis === 'percent' && net === null) return fail('Add the tuition fee to the application first.');
    if (rule.basis === 'percent' && c.tuitionCurrency && c.tuitionCurrency !== found.agreement.currency) {
      return fail(`The tuition is in ${c.tuitionCurrency} but the agreement pays in ${found.agreement.currency}.`);
    }
    const years = rule.years === 'each_year' ? rule.yearCount : 1;
    const start = c.courseStart;
    const snapshot = { name: rule.name, basis: rule.basis, rateBp: rule.rateBp, fixedAmount: rule.fixedAmount, years: rule.years, yearCount: rule.yearCount, tiers: rule.tiers, retentionDays: rule.retentionDays, agreementVersion: found.agreement.version };
    let made = 0;
    for (let year = 1; year <= years; year++) {
      const rateBp = rule.basis === 'percent' ? rule.rateBp : null;
      const amount = commissionAmount({ basis: rule.basis as 'percent' | 'fixed', fixedAmount: rule.fixedAmount / 100 }, net ?? 0, rule.rateBp);
      if (amount <= 0) continue;
      const yearStart = start ? addYears(start, year - 1) : null;
      const claimableOn = yearStart ? addDays(yearStart, found.agreement.claimAfterDays) : null;
      const created = await withDocumentNumber(this.db, commissions, tenantId, 'COM', async (number) => {
        const rows = await this.db
          .insert(commissions)
          .values({
            tenantId,
            number,
            kind: 'student',
            caseId: c.id,
            clientId: c.clientId,
            institutionId: c.institutionId!,
            agreementId: found.agreement.id,
            ruleId: rule.id,
            ruleSnapshot: snapshot,
            yearNo: year,
            intake: c.intake,
            tuition: net,
            rateBp,
            amount,
            currency: found.agreement.currency,
            status: 'expected',
            claimableOn,
            expectedOn: claimableOn ? addDays(claimableOn, found.agreement.paymentTermsDays) : null,
            createdBy: actor?.id ?? null,
          })
          .onConflictDoNothing()
          .returning();
        return rows[0] ?? null;
      });
      if (!created) continue;
      made++;
      await this.defaultSplit(tenantId, created.id, k.consultantUserId);
      await this.audit.record(actor, {
        tenantId,
        action: 'commission.created',
        entityType: 'commission',
        entityId: created.id,
        caseId: c.id,
        clientId: c.clientId,
        metadata: { number: created.number, amount, currency: created.currency, year, rule: rule.name },
      });
    }
    return made;
  }

  /**
   * The application's institution, fees or start date changed. What is only
   * expected follows: re-priced on the new tuition and re-dated from the new
   * start, or cancelled when the application has moved to another
   * institution (the new one's is then worked out). Anything confirmed keeps
   * what was earned - a change to that is an adjustment, made by hand.
   */
  async followEnrolment(tenantId: string, caseId: string, actor: AuthUser): Promise<void> {
    const [k] = await this.db.select().from(cases).where(and(eq(cases.id, caseId), eq(cases.tenantId, tenantId))).limit(1);
    if (!k) return;
    const open = await this.db
      .select({ c: commissions, claimAfterDays: commissionAgreements.claimAfterDays, paymentTermsDays: commissionAgreements.paymentTermsDays })
      .from(commissions)
      .leftJoin(commissionAgreements, eq(commissionAgreements.id, commissions.agreementId))
      .where(and(eq(commissions.caseId, caseId), eq(commissions.kind, 'student'), eq(commissions.status, 'expected')));
    for (const { c, claimAfterDays, paymentTermsDays } of open) {
      if (c.institutionId !== k.institutionId) {
        const why = k.institutionId ? 'The application moved to another institution.' : 'The application no longer names an institution.';
        await this.db.update(commissions).set({ status: 'cancelled', note: why, updatedAt: new Date() }).where(and(eq(commissions.id, c.id), eq(commissions.status, 'expected')));
        await this.audit.record(actor, { tenantId, action: 'commission.status_changed', entityType: 'commission', entityId: c.id, caseId, metadata: { number: c.number, from: 'expected', to: 'cancelled', reason: why } });
        continue;
      }
      // Commission added by hand has no rule to re-price it by.
      if (!c.agreementId) continue;
      const snap = c.ruleSnapshot as { basis?: string } | null;
      const net = k.tuitionFee === null ? null : Math.max(0, k.tuitionFee - (k.scholarship ?? 0));
      const sameCurrency = !k.tuitionCurrency || k.tuitionCurrency === c.currency;
      const amount = snap?.basis === 'percent' && net !== null && sameCurrency && c.rateBp !== null ? Math.round((net * c.rateBp) / 10_000) : c.amount;
      const yearStart = k.courseStart ? addYears(k.courseStart, c.yearNo - 1) : null;
      const claimableOn = yearStart ? addDays(yearStart, claimAfterDays ?? 0) : null;
      const expectedOn = claimableOn ? addDays(claimableOn, paymentTermsDays ?? 0) : null;
      const tuition = snap?.basis === 'percent' && net !== null && sameCurrency ? net : c.tuition;
      if (amount === c.amount && tuition === c.tuition && claimableOn === c.claimableOn && expectedOn === c.expectedOn) continue;
      if (amount <= 0) continue;
      await this.db.update(commissions).set({ amount, tuition, claimableOn, expectedOn, dueNotifiedAt: null, updatedAt: new Date() }).where(and(eq(commissions.id, c.id), eq(commissions.status, 'expected')));
      await this.audit.record(actor, {
        tenantId,
        action: 'commission.adjusted',
        entityType: 'commission',
        entityId: c.id,
        caseId,
        metadata: { number: c.number, from: c.amount, to: amount, tuition, claimableOn, reason: 'The application’s fees or start date changed.' },
      });
    }
  }

  /** Staff ask for it to be worked out now, from the application's page. */
  async workOutFor(actor: AuthUser, caseId: string): Promise<CommissionView[]> {
    this.assertManage(actor);
    await this.cases.findAccessible(actor, caseId);
    const made = await this.workOut(tenantOf(actor), caseId, actor, true);
    if (!made) throw new BadRequestException('Its commission is already worked out.');
    return this.forCase(actor, caseId);
  }

  /** A commission added by hand - a bonus, an adjustment, or one the rules do not cover. */
  async createManual(actor: AuthUser, raw: ManualCommissionInput): Promise<CommissionView> {
    this.assertManage(actor);
    const input = manualCommissionSchema.parse(raw);
    const tenantId = tenantOf(actor);
    await this.institutions.find(tenantId, input.institutionId);
    let clientId: string | null = null;
    let intake: string | null = null;
    if (input.caseId) {
      const row = await this.cases.findAccessible(actor, input.caseId);
      if (row.case.institutionId && row.case.institutionId !== input.institutionId) throw new BadRequestException('That application is with another institution.');
      clientId = row.case.clientId;
      intake = row.case.intake;
    }
    const created = await withDocumentNumber(this.db, commissions, tenantId, 'COM', async (number) => {
      const [row] = await this.db
        .insert(commissions)
        .values({
          tenantId,
          number,
          kind: input.kind,
          caseId: input.caseId ?? null,
          clientId,
          institutionId: input.institutionId,
          yearNo: input.yearNo,
          intake,
          amount: Math.round(input.amount * 100),
          currency: input.currency,
          status: 'expected',
          expectedOn: input.expectedOn ?? null,
          note: input.note,
          createdBy: actor.id,
        })
        .returning();
      return row!;
    });
    await this.audit.record(actor, { action: 'commission.created', entityType: 'commission', entityId: created.id, caseId: input.caseId ?? null, metadata: { number: created.number, amount: created.amount, kind: input.kind, manual: true } });
    return this.get(actor, created.id);
  }

  /* ---------------------------------------------------------------- */
  /* Through its life                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * The student enrolled: the commission is earned. Volume tiers are
   * applied now (counting this student), it is booked - receivable from the
   * institution, commission income - and a bonus is added if this student
   * reaches the agreement's bonus threshold.
   */
  async confirm(actor: AuthUser, id: string, raw: ConfirmCommissionInput): Promise<CommissionView> {
    this.assertManage(actor);
    const input = confirmCommissionSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const c = await this.find(tenantId, id);
    if (c.status !== 'expected') throw new BadRequestException('Only an expected commission can be confirmed.');
    if (input.enrolledOn > today()) throw new BadRequestException({ message: 'That date is in the future.', fieldErrors: { enrolledOn: 'When did they enrol?' } });
    const base = await this.ledger.baseCurrency(tenantId);
    const fxRate = c.currency === base ? 1 : (input.fxRate ?? null);

    let amount = c.amount;
    let rateBp = c.rateBp;
    let rule: typeof commissionRules.$inferSelect | undefined;
    let confirmedStudents = 0;
    if (c.ruleId) [rule] = await this.db.select().from(commissionRules).where(eq(commissionRules.id, c.ruleId)).limit(1);
    if (c.agreementId && c.kind === 'student') {
      const [n] = await this.db
        .select({ n: sql<number>`count(distinct ${commissions.caseId})::int` })
        .from(commissions)
        .where(and(eq(commissions.agreementId, c.agreementId), eq(commissions.kind, 'student'), inArray(commissions.status, ['confirmed', 'claimed', 'disputed', 'written_off', 'clawed_back']), c.caseId ? ne(commissions.caseId, c.caseId) : undefined));
      confirmedStudents = (n?.n ?? 0) + 1;
    }
    const snap = c.ruleSnapshot as { basis?: string; tiers?: { fromStudents: number; ratePercent: number }[]; retentionDays?: number; rateBp?: number } | null;
    if (snap?.basis === 'percent' && c.tuition !== null && snap.tiers?.length) {
      rateBp = tierRateBp({ ratePercent: bpToPercent(snap.rateBp ?? 0), tiers: snap.tiers }, confirmedStudents);
      amount = Math.round((c.tuition * rateBp) / 10_000);
    }
    if (input.amount) amount = Math.round(input.amount * 100);
    const retentionUntil = snap?.retentionDays ? addDays(input.enrolledOn, snap.retentionDays) : null;

    await this.db.transaction(async (tx) => {
      await tx
        .update(commissions)
        .set({ status: 'confirmed', amount, rateBp, fxRate: fxRate === null ? null : String(fxRate), confirmedAt: new Date(), retentionUntil, updatedAt: new Date() })
        .where(and(eq(commissions.id, id), eq(commissions.status, 'expected')));
      await postEntry(tx, {
        tenantId,
        date: input.enrolledOn,
        memo: `Commission ${c.number}${c.kind === 'student' ? `, year ${c.yearNo}` : ''}`,
        currency: c.currency,
        fxRate,
        sourceType: 'commission',
        sourceId: id,
        createdBy: actor.id,
        lines: [
          { account: 'commission_receivable', debit: amount, clientId: c.clientId },
          { account: 'commission_income', credit: amount },
        ],
      });
    });
    await this.audit.record(actor, {
      action: 'commission.status_changed',
      entityType: 'commission',
      entityId: id,
      caseId: c.caseId,
      clientId: c.clientId,
      metadata: { number: c.number, to: 'confirmed', amount, was: c.amount, rateBp, enrolledOn: input.enrolledOn, confirmedStudents },
    });
    await this.emitCommission({ type: 'confirmed', tenantId, commissionId: id, on: input.enrolledOn, actor });

    // The agreement's volume bonus, once, when this student reaches it.
    if (rule?.bonusStudents && rule.bonusAmount && c.agreementId && confirmedStudents >= rule.bonusStudents) {
      const [existing] = await this.db.select({ id: commissions.id }).from(commissions).where(and(eq(commissions.agreementId, c.agreementId), eq(commissions.kind, 'bonus'), ne(commissions.status, 'cancelled'))).limit(1);
      if (!existing) {
        const bonus = await withDocumentNumber(this.db, commissions, tenantId, 'COM', (number) =>
          this.db.transaction(async (tx) => {
            const [row] = await tx
              .insert(commissions)
              .values({
                tenantId,
                number,
                kind: 'bonus',
                institutionId: c.institutionId,
                agreementId: c.agreementId,
                ruleId: rule!.id,
                ruleSnapshot: { name: `${rule!.name}: bonus for ${rule!.bonusStudents} students` },
                amount: rule!.bonusAmount!,
                currency: c.currency,
                fxRate: fxRate === null ? null : String(fxRate),
                status: 'confirmed',
                confirmedAt: new Date(),
                expectedOn: c.expectedOn,
                note: `Volume bonus: ${rule!.bonusStudents} students confirmed under the agreement.`,
                createdBy: actor.id,
              })
              .returning();
            await postEntry(tx, {
              tenantId,
              date: input.enrolledOn,
              memo: `Volume bonus ${number}`,
              currency: c.currency,
              fxRate,
              sourceType: 'commission',
              sourceId: row!.id,
              createdBy: actor.id,
              lines: [
                { account: 'commission_receivable', debit: row!.amount },
                { account: 'commission_income', credit: row!.amount },
              ],
            });
            return row!;
          }),
        );
        await this.audit.record(actor, { action: 'commission.created', entityType: 'commission', entityId: bonus.id, metadata: { number: bonus.number, amount: bonus.amount, kind: 'bonus' } });
      }
    }
    return this.get(actor, id);
  }

  /** Never earned: the student did not enrol. Undoes the booking if there was one. */
  async cancel(actor: AuthUser, id: string, reason: string): Promise<CommissionView> {
    this.assertManage(actor);
    const tenantId = tenantOf(actor);
    const v = await this.get(actor, id);
    if (v.received !== 0) throw new BadRequestException('Money has been received against it. Clawed back or written off - not cancelled.');
    if (!['expected', 'confirmed', 'claimed', 'disputed'].includes(v.status)) throw new BadRequestException(`It is ${v.status.replace('_', ' ')} already.`);
    await this.db.transaction(async (tx) => {
      await tx.update(commissions).set({ status: 'cancelled', claimId: null, note: reason, updatedAt: new Date() }).where(eq(commissions.id, id));
      const entry = await liveEntryFor(tx, tenantId, 'commission', id);
      if (entry) await reverseEntry(tx, entry, { date: today(), memo: `Commission ${v.number} cancelled: ${reason}`, sourceType: 'reversal', createdBy: actor.id });
    });
    await this.audit.record(actor, { action: 'commission.status_changed', entityType: 'commission', entityId: id, caseId: v.caseId, metadata: { number: v.number, from: v.status, to: 'cancelled', reason } });
    await this.emitCommission({ type: 'cancelled', tenantId, commissionId: id, on: today(), actor });
    return this.get(actor, id);
  }

  /** The institution questions it. */
  async dispute(actor: AuthUser, id: string, reason: string): Promise<CommissionView> {
    this.assertManage(actor);
    const v = await this.get(actor, id);
    if (v.status !== 'confirmed' && v.status !== 'claimed') throw new BadRequestException('Only a confirmed or claimed commission can be disputed.');
    await this.db.update(commissions).set({ status: 'disputed', note: reason, updatedAt: new Date() }).where(eq(commissions.id, id));
    await this.audit.record(actor, { action: 'commission.status_changed', entityType: 'commission', entityId: id, caseId: v.caseId, metadata: { number: v.number, from: v.status, to: 'disputed', reason } });
    return this.get(actor, id);
  }

  async resolveDispute(actor: AuthUser, id: string, reason: string): Promise<CommissionView> {
    this.assertManage(actor);
    const v = await this.get(actor, id);
    if (v.status !== 'disputed') throw new BadRequestException('It is not disputed.');
    const to = v.claimId ? 'claimed' : 'confirmed';
    await this.db.update(commissions).set({ status: to, note: reason, updatedAt: new Date() }).where(eq(commissions.id, id));
    await this.audit.record(actor, { action: 'commission.status_changed', entityType: 'commission', entityId: id, caseId: v.caseId, metadata: { number: v.number, from: 'disputed', to, reason } });
    return this.get(actor, id);
  }

  /** Given up on: what is still owed becomes a bad debt. */
  async writeOff(actor: AuthUser, id: string, reason: string): Promise<CommissionView> {
    this.assertManage(actor);
    const tenantId = tenantOf(actor);
    const v = await this.get(actor, id);
    if (!OPEN.includes(v.status) || v.outstanding <= 0) throw new BadRequestException('Nothing is outstanding on it.');
    const [row] = await this.db.select({ fxRate: commissions.fxRate }).from(commissions).where(eq(commissions.id, id));
    await this.db.transaction(async (tx) => {
      await tx.update(commissions).set({ status: 'written_off', adjustedAmount: v.outstanding, note: reason, updatedAt: new Date() }).where(eq(commissions.id, id));
      await postEntry(tx, {
        tenantId,
        date: today(),
        memo: `Commission ${v.number} written off: ${reason}`,
        currency: v.currency,
        fxRate: row?.fxRate ?? null,
        sourceType: 'commission',
        sourceId: id,
        createdBy: actor.id,
        lines: [
          { account: 'bad_debts', debit: v.outstanding },
          { account: 'commission_receivable', credit: v.outstanding, clientId: v.clientId },
        ],
      });
    });
    await this.audit.record(actor, { action: 'commission.adjusted', entityType: 'commission', entityId: id, caseId: v.caseId, metadata: { number: v.number, to: 'written_off', amount: v.outstanding, reason } });
    return this.get(actor, id);
  }

  /**
   * The student left within the retention period and the institution takes
   * back what it paid. The income is reversed; the institution now holds a
   * credit, which the next receipt from it settles with a deduction.
   */
  async clawback(actor: AuthUser, id: string, raw: ClawbackInput): Promise<CommissionView> {
    this.assertManage(actor);
    const input = clawbackSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const v = await this.get(actor, id);
    if (v.received <= 0) throw new BadRequestException('Nothing has been received on it; cancel it instead.');
    if (!OPEN.includes(v.status)) throw new BadRequestException(`It is ${v.status.replace('_', ' ')}.`);
    const amount = input.amount ? Math.round(input.amount * 100) : v.received;
    if (amount > v.received) throw new BadRequestException({ message: `Only ${formatMoney(v.received, v.currency)} was received.`, fieldErrors: { amount: 'More than was received' } });
    const [row] = await this.db.select({ fxRate: commissions.fxRate }).from(commissions).where(eq(commissions.id, id));
    await this.db.transaction(async (tx) => {
      await tx.update(commissions).set({ status: 'clawed_back', adjustedAmount: amount, note: input.reason, updatedAt: new Date() }).where(eq(commissions.id, id));
      await postEntry(tx, {
        tenantId,
        date: today(),
        memo: `Commission ${v.number} clawed back: ${input.reason}`,
        currency: v.currency,
        fxRate: row?.fxRate ?? null,
        sourceType: 'commission',
        sourceId: id,
        createdBy: actor.id,
        lines: [
          { account: 'commission_income', debit: amount },
          { account: 'commission_receivable', credit: amount, clientId: v.clientId },
        ],
      });
    });
    await this.audit.record(actor, { action: 'commission.adjusted', entityType: 'commission', entityId: id, caseId: v.caseId, metadata: { number: v.number, to: 'clawed_back', amount, reason: input.reason } });
    await this.emitCommission({ type: 'clawed_back', tenantId, commissionId: id, amount, on: today(), actor });
    return this.get(actor, id);
  }

  /* ---------------------------------------------------------------- */
  /* Staff incentives                                                  */
  /* ---------------------------------------------------------------- */

  private async defaultSplit(tenantId: string, commissionId: string, consultantUserId: string | null): Promise<void> {
    if (!consultantUserId) return;
    const s = await this.settingsRow(tenantId);
    if (s.consultantShareBp <= 0) return;
    await this.db.insert(commissionSplits).values({ tenantId, commissionId, userId: consultantUserId, shareBp: s.consultantShareBp }).onConflictDoNothing();
  }

  async setSplits(actor: AuthUser, id: string, raw: CommissionSplitInput): Promise<CommissionView> {
    this.assertManage(actor);
    const input = commissionSplitSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const v = await this.get(actor, id);
    const paid = v.splits.filter((s) => s.paidOn);
    if (paid.some((p) => !input.splits.find((s) => s.userId === p.userId && percentToBp(s.sharePercent) === p.shareBp))) {
      throw new BadRequestException('An incentive already paid cannot change. Keep its share as it is.');
    }
    const staff = await this.db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tenantId), inArray(users.role, ['manager', 'consultant']), inArray(users.id, input.splits.map((s) => s.userId).concat(['00000000-0000-0000-0000-000000000000']))));
    if (staff.length !== input.splits.length) throw new BadRequestException('Shares go to members of staff of this consultancy.');
    await this.db.transaction(async (tx) => {
      await tx.delete(commissionSplits).where(and(eq(commissionSplits.commissionId, id), isNull(commissionSplits.paidOn)));
      const unpaid = input.splits.filter((s) => !paid.find((p) => p.userId === s.userId));
      if (unpaid.length) await tx.insert(commissionSplits).values(unpaid.map((s) => ({ tenantId, commissionId: id, userId: s.userId, shareBp: percentToBp(s.sharePercent) })));
    });
    await this.audit.record(actor, { action: 'commission.adjusted', entityType: 'commission', entityId: id, metadata: { number: v.number, splits: input.splits } });
    return this.get(actor, id);
  }

  /** Pays someone their share - once the institution has paid in full. Booked as an expense. */
  async payIncentive(actor: AuthUser, splitId: string, raw: PayIncentiveInput): Promise<CommissionView> {
    this.assertManage(actor);
    if (!staffCan(actor, 'payout.manage') && actor.role !== 'manager') throw new ForbiddenException('You need “Pay partners” to pay out incentives.');
    const input = payIncentiveSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const [s] = await this.db.select().from(commissionSplits).where(and(eq(commissionSplits.id, splitId), eq(commissionSplits.tenantId, tenantId))).limit(1);
    if (!s) throw new NotFoundException('Share not found.');
    const v = await this.get(actor, s.commissionId);
    const split = v.splits.find((x) => x.id === splitId)!;
    if (split.paidOn) throw new BadRequestException('Already paid.');
    if (!split.payable) throw new BadRequestException('It is paid once the institution has paid the commission in full.');
    await assertMoneyAccount(this.db, tenantId, input.accountId);
    const [row] = await this.db.select({ fxRate: commissions.fxRate }).from(commissions).where(eq(commissions.id, v.id));
    await this.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(commissionSplits)
        .set({ paidOn: input.paidOn, paidAmount: split.amount, paidBy: actor.id, accountId: input.accountId })
        .where(and(eq(commissionSplits.id, splitId), isNull(commissionSplits.paidOn)))
        .returning();
      if (!claimed) throw new BadRequestException('Already paid.');
      await postEntry(tx, {
        tenantId,
        date: input.paidOn,
        memo: `Incentive: ${split.userName}, ${v.number}`,
        currency: v.currency,
        fxRate: row?.fxRate ?? null,
        sourceType: 'incentive',
        sourceId: splitId,
        createdBy: actor.id,
        lines: [
          { account: 'staff_incentives', debit: split.amount },
          { account: { id: input.accountId }, credit: split.amount },
        ],
      });
    });
    await this.audit.record(actor, { action: 'payout.paid', entityType: 'commission', entityId: v.id, metadata: { incentive: splitId, to: split.userName, amount: split.amount, currency: v.currency } });
    await this.notifications.push({ userId: s.userId, type: 'payout_ready', title: `Your incentive of ${formatMoney(split.amount, v.currency)} has been paid`, body: `For ${v.clientName ?? v.number}.`, link: '/desk/workload' });
    return this.get(actor, v.id);
  }

  /** A member of staff's own shares, paid and to come. */
  /** The people a commission can be shared with: the consultancy's active staff. */
  async staffOptions(actor: AuthUser): Promise<{ id: string; name: string }[]> {
    this.assertManage(actor);
    return this.db
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .where(and(eq(users.tenantId, tenantOf(actor)), inArray(users.role, ['manager', 'consultant']), eq(users.isActive, true)))
      .orderBy(asc(users.fullName));
  }

  async myIncentives(actor: AuthUser): Promise<{ splits: (CommissionSplitView & { commission: Pick<CommissionView, 'id' | 'number' | 'clientName' | 'institutionName' | 'stage'> })[] }> {
    if (actor.role !== 'manager' && actor.role !== 'consultant') throw new ForbiddenException();
    const rows = await this.db
      .select({ commissionId: commissionSplits.commissionId })
      .from(commissionSplits)
      .where(and(eq(commissionSplits.tenantId, tenantOf(actor)), eq(commissionSplits.userId, actor.id)))
      .limit(500);
    const views = await this.views([...new Set(rows.map((r) => r.commissionId))]);
    return {
      splits: views
        .filter((v) => v.status !== 'cancelled')
        .flatMap((v) =>
          v.splits.filter((s) => s.userId === actor.id).map((s) => ({ ...s, commission: { id: v.id, number: v.number, clientName: v.clientName, institutionName: v.institutionName, stage: v.stage } })),
        ),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Settings and the dashboard                                        */
  /* ---------------------------------------------------------------- */

  private async settingsRow(tenantId: string) {
    const [row] = await this.db.select().from(commissionSettings).where(eq(commissionSettings.tenantId, tenantId)).limit(1);
    if (row) return row;
    await this.db.insert(commissionSettings).values({ tenantId }).onConflictDoNothing();
    return (await this.db.select().from(commissionSettings).where(eq(commissionSettings.tenantId, tenantId)).limit(1))[0]!;
  }

  async settings(actor: AuthUser): Promise<CommissionSettingsView> {
    this.assertView(actor);
    const s = await this.settingsRow(tenantOf(actor));
    return { consultantSharePercent: bpToPercent(s.consultantShareBp), followUpDays: s.followUpDays };
  }

  async saveSettings(actor: AuthUser, raw: CommissionSettingsInput): Promise<CommissionSettingsView> {
    this.assertManage(actor);
    const input = commissionSettingsSchema.parse(raw);
    const tenantId = tenantOf(actor);
    await this.settingsRow(tenantId);
    await this.db.update(commissionSettings).set({ consultantShareBp: percentToBp(input.consultantSharePercent), followUpDays: input.followUpDays, updatedBy: actor.id, updatedAt: new Date() }).where(eq(commissionSettings.tenantId, tenantId));
    await this.audit.record(actor, { action: 'finance.settings_changed', entityType: 'settings', entityId: tenantId, metadata: { commissions: input } });
    return this.settings(actor);
  }

  async overview(actor: AuthUser, claimsOverdue: CommissionsOverview['claimsOverdue']): Promise<CommissionsOverview> {
    this.assertView(actor);
    const tenantId = tenantOf(actor);
    const yearStart = `${today().slice(0, 4)}-01-01`;
    const horizon = addDays(today(), 366);
    type Row = { currency: string; status: string; claimed: boolean; amount: string; received: string; received_year: string; n: number };
    const res = await this.db.execute<Row>(sql`
      select c.currency, c.status, (c.claim_id is not null) as claimed,
        sum(c.amount) as amount, sum(coalesce(r.received, 0)) as received, sum(coalesce(r.received_year, 0)) as received_year, count(*)::int as n
      from commissions c
      left join (
        select a.commission_id, sum(a.amount) as received, sum(a.amount) filter (where ir.received_on >= ${yearStart}) as received_year
        from receipt_allocations a join institution_receipts ir on ir.id = a.receipt_id
        where ir.voided_at is null and ir.tenant_id = ${tenantId}
        group by a.commission_id
      ) r on r.commission_id = c.id
      where c.tenant_id = ${tenantId} and c.status <> 'cancelled'
      group by c.currency, c.status, (c.claim_id is not null)`);
    const rows = (res as unknown as { rows?: Row[] }).rows ?? (res as unknown as Row[]);
    const totals = new Map<string, CommissionTotals>();
    let disputed = 0;
    for (const r of rows) {
      const t = totals.get(r.currency) ?? { currency: r.currency as Currency, expected: 0, toClaim: 0, claimed: 0, received: 0, receivedThisYear: 0, overdueClaims: 0 };
      const amount = Number(r.amount);
      const received = Number(r.received);
      t.received += received;
      t.receivedThisYear += Number(r.received_year);
      if (r.status === 'expected') t.expected += amount;
      else if (r.status === 'confirmed' && !r.claimed) t.toClaim += Math.max(0, amount - received);
      else if (OPEN.includes(r.status as CommissionStatus)) t.claimed += Math.max(0, amount - received);
      if (r.status === 'disputed') disputed += r.n;
      totals.set(r.currency, t);
    }
    for (const c of claimsOverdue) {
      const t = totals.get(c.currency);
      if (t) t.overdueClaims++;
    }
    const [forecastRows, byInst] = await Promise.all([
      this.db
        .select({
          month: sql<string>`to_char(${commissions.expectedOn}, 'YYYY-MM')`,
          currency: commissions.currency,
          expected: sql<string>`coalesce(sum(${commissions.amount}) filter (where ${commissions.status} = 'expected'), 0)`,
          confirmed: sql<string>`coalesce(sum(${commissions.amount} - ${receivedSql}) filter (where ${commissions.status} in ('confirmed','claimed','disputed')), 0)`,
        })
        .from(commissions)
        .where(and(eq(commissions.tenantId, tenantId), sql`${commissions.expectedOn} is not null`, sql`${commissions.expectedOn} <= ${horizon}`, inArray(commissions.status, ['expected', 'confirmed', 'claimed', 'disputed'])))
        .groupBy(sql`1`, commissions.currency)
        .orderBy(sql`1`),
      this.db
        .select({
          institutionId: institutions.id,
          name: institutions.name,
          currency: commissions.currency,
          outstanding: sql<string>`coalesce(sum(${commissions.amount} - ${receivedSql}) filter (where ${commissions.status} in ('confirmed','claimed','disputed')), 0)`,
          students: sql<number>`count(distinct ${commissions.caseId})::int`,
        })
        .from(commissions)
        .innerJoin(institutions, eq(institutions.id, commissions.institutionId))
        .where(and(eq(commissions.tenantId, tenantId), ne(commissions.status, 'cancelled')))
        .groupBy(institutions.id, institutions.name, commissions.currency)
        .orderBy(sql`4 desc`)
        .limit(15),
    ]);
    const receivedByInst = await this.db.execute<{ id: string; currency: string; n: string }>(sql`
      select c.institution_id as id, c.currency, coalesce(sum(a.amount), 0) as n
      from receipt_allocations a
      join institution_receipts ir on ir.id = a.receipt_id
      join commissions c on c.id = a.commission_id
      where ir.voided_at is null and ir.tenant_id = ${tenantId} and ir.received_on >= ${yearStart}
      group by c.institution_id, c.currency`);
    const rbi = ((receivedByInst as unknown as { rows?: { id: string; currency: string; n: string }[] }).rows ?? (receivedByInst as unknown as { id: string; currency: string; n: string }[]));
    return {
      totals: [...totals.values()],
      forecast: forecastRows.map((f) => ({ month: f.month, currency: f.currency as Currency, expected: Number(f.expected), confirmed: Number(f.confirmed) })),
      byInstitution: byInst.map((b) => ({
        institutionId: b.institutionId,
        name: b.name,
        currency: b.currency as Currency,
        outstanding: Number(b.outstanding),
        receivedThisYear: Number(rbi.find((x) => x.id === b.institutionId && x.currency === b.currency)?.n ?? 0),
        students: b.students,
      })),
      claimsOverdue,
      disputed,
    };
  }

  /* ---------------------------------------------------------------- */
  /* The sweep                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Hourly: commissions whose claim window has opened (once each), and sent
   * claims past their due date (every follow-up interval), go to whoever
   * manages commissions.
   */
  async followUps(): Promise<number> {
    let sent = 0;
    const day = today();
    const due = await this.db
      .update(commissions)
      .set({ dueNotifiedAt: new Date() })
      .where(and(inArray(commissions.status, ['expected', 'confirmed']), isNull(commissions.claimId), isNull(commissions.dueNotifiedAt), sql`${commissions.claimableOn} <= ${day}`))
      .returning({ id: commissions.id, tenantId: commissions.tenantId, number: commissions.number, status: commissions.status, clientId: commissions.clientId, amount: commissions.amount, currency: commissions.currency });
    for (const c of due) {
      const [who] = c.clientId ? await this.db.select({ name: clients.fullName }).from(clients).where(eq(clients.id, c.clientId)) : [];
      const managers = await permissionHolders(this.db, c.tenantId, 'commission.manage');
      await this.notifications.pushMany(managers, {
        type: 'commission_due',
        title: `${who?.name ?? c.number}: commission of ${formatMoney(c.amount, c.currency)} can be ${c.status === 'expected' ? 'confirmed and claimed' : 'claimed'}`,
        body: 'The claim window has opened.',
        link: `/overview/commissions/list?view=${c.status === 'expected' ? 'expected' : 'to_claim'}`,
      });
      sent++;
    }
    const settings = await this.db.select().from(commissionSettings);
    const followEvery = new Map(settings.map((s) => [s.tenantId, s.followUpDays]));
    const claims = await this.db
      .select({ id: commissionClaims.id, tenantId: commissionClaims.tenantId, number: commissionClaims.number, institution: institutions.name, last: commissionClaims.lastFollowUpAt, dueOn: commissionClaims.dueOn })
      .from(commissionClaims)
      .innerJoin(institutions, eq(institutions.id, commissionClaims.institutionId))
      .where(and(inArray(commissionClaims.status, ['submitted', 'disputed']), sql`${commissionClaims.dueOn} < ${day}`));
    for (const cl of claims) {
      const every = followEvery.get(cl.tenantId) ?? 14;
      if (cl.last && Date.now() - cl.last.getTime() < every * 86_400_000) continue;
      const [claimed] = await this.db
        .update(commissionClaims)
        .set({ lastFollowUpAt: new Date() })
        .where(and(eq(commissionClaims.id, cl.id), cl.last ? eq(commissionClaims.lastFollowUpAt, cl.last) : isNull(commissionClaims.lastFollowUpAt)))
        .returning({ id: commissionClaims.id });
      if (!claimed) continue;
      const managers = await permissionHolders(this.db, cl.tenantId, 'commission.manage');
      await this.notifications.pushMany(managers, {
        type: 'claim_follow_up',
        title: `Chase ${cl.institution}: claim ${cl.number} was due ${cl.dueOn}`,
        body: 'It is not paid in full yet.',
        link: `/overview/commissions/claims/${cl.id}`,
        email: true,
      });
      sent++;
    }
    return sent;
  }

  async find(tenantId: string, id: string): Promise<CommissionRow> {
    const [row] = await this.db.select().from(commissions).where(and(eq(commissions.id, id), eq(commissions.tenantId, tenantId))).limit(1);
    if (!row) throw new NotFoundException('Commission not found.');
    return row;
  }
}
