import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, ne, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import {
  localIsoDateIn,
  STAGE_DEFINITIONS,
  STAGE_ORDER,
  type AuthUser,
  type Paginated,
  type Stage,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { auditLog, cases, clients, consultants, documents, users } from '../db/schema';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { AUDIT_CATEGORIES } from '@crm/shared';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * "Has this case stopped moving?" expressed in SQL.
 *
 * The per-stage thresholds live in @crm/shared so the API, the client's
 * progress view and the manager's alerts all agree on what "stuck" means.
 * This builds a CASE expression from that same config rather than hard-coding
 * a single global number, because two weeks in Documents Collection is normal
 * and two weeks waiting on an offer letter is not.
 *
 * A workflow sets its own limit per stage, copied onto the application as
 * it enters the stage (stage_sla_days); the built-in numbers are the
 * fallback, and are what the Standard workflow uses.
 *
 * The interpolated values are integers from our own constants, never user
 * input.
 */
function stuckThresholdSql(): SQL {
  const branches = STAGE_ORDER.map(
    (s) => `when '${s}' then interval '${STAGE_DEFINITIONS[s].stuckAfterDays} days'`,
  ).join(' ');
  return sql.raw(`coalesce(${cases.stageSlaDays.name} * interval '1 day', (case ${cases.currentStage.name} ${branches} end))`);
}

const isStuckSql = (): SQL =>
  sql`${cases.stageEnteredAt} < now() - ${stuckThresholdSql()}`;

/** Whole days past the point this stage should have cleared. */
const daysOverdueSql = (): SQL<number> =>
  sql<number>`greatest(0, extract(day from (now() - ${cases.stageEnteredAt} - ${stuckThresholdSql()})))::int`;

export interface FunnelStage {
  stage: Stage;
  label: string;
  clientLabel: string;
  total: number;
  stuck: number;
}

export interface FunnelResponse {
  stages: FunnelStage[];
  totalActive: number;
  totalStuck: number;
  /** Cases that reached a terminal outcome, for the conversion line. */
  approved: number;
  rejected: number;
}

export interface TrendPoint {
  /** `YYYY-MM`, so the client can key and sort without parsing a label. */
  period: string;
  label: string;
  opened: number;
  approved: number;
  rejected: number;
  /** Clients who joined that month. Feeds the sparkline on the intake card. */
  newClients: number;
}

export interface TrendsResponse {
  points: TrendPoint[];
  openedTotal: number;
  approvedTotal: number;
}

export interface CaseHealthSegment {
  key: 'on_track' | 'awaiting_us' | 'stalled';
  label: string;
  count: number;
  /** The status tone this segment already wears everywhere else in the product. */
  tone: 'ok' | 'warn' | 'bad';
}

export interface CaseHealthResponse {
  total: number;
  segments: CaseHealthSegment[];
}

export interface KpiResponse {
  activeCases: number;
  stalledCases: number;
  approvedAllTime: number;
  pendingReviews: number;
  newClients30: number;
  newClientsDeltaPct: number | null;
  approved30: number;
  approvedDeltaPct: number | null;
  documentsCleared30: number;
  documentsClearedDeltaPct: number | null;
}

const MONTH_LABEL = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Period-on-period change.
 *
 * `null` when the previous period was zero: "up 100%" from nothing is not a
 * fact, and the UI renders the absence as no change figure at all rather than
 * inventing one.
 */
function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export interface DeadlineItem {
  kind: 'application' | 'offer' | 'visa_appointment' | 'travel' | 'passport';
  date: string;
  caseId: string;
  reference: string;
  clientId: string;
  clientName: string;
  consultantName: string | null;
  targetCountry: string;
  targetUniversity: string | null;
}

export interface DestinationRow {
  country: string;
  total: number;
  active: number;
  approved: number;
  rejected: number;
}

export interface StuckCase {
  id: string;
  reference: string;
  clientId: string;
  clientName: string;
  consultantId: string | null;
  consultantName: string | null;
  targetCountry: string;
  currentStage: Stage;
  /** The stage's name in the application's own workflow. */
  currentStageName: string | null;
  stageEnteredAt: string;
  daysInStage: number;
  daysOverdue: number;
  pendingDocuments: number;
}

@Injectable()
export class AnalyticsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Consultants see their own numbers; managers see their whole consultancy,
   * optionally narrowed to one consultant. Scoping is in SQL, as everywhere
   * else, and the consultancy boundary applies before any of it - a manager's
   * "everything" is everything in their own consultancy.
   */
  private scope(actor: AuthUser, consultantId?: string): SQL | undefined {
    return and(eq(cases.tenantId, tenantOf(actor)), this.roleScope(actor, consultantId));
  }

  /** The same rules for queries that count clients rather than cases. */
  private clientScope(actor: AuthUser, consultantId?: string): SQL | undefined {
    const tenant = eq(clients.tenantId, tenantOf(actor));
    if (actor.role === 'consultant') {
      return and(tenant, eq(clients.assignedConsultantId, actor.consultantId ?? NIL_UUID));
    }
    if (actor.role === 'manager' && consultantId) {
      return and(tenant, eq(clients.assignedConsultantId, consultantId));
    }
    if (actor.role === 'client') return sql`false`;
    return tenant;
  }

  private roleScope(actor: AuthUser, consultantId?: string): SQL | undefined {
    if (actor.role === 'consultant') {
      return eq(cases.consultantId, actor.consultantId ?? NIL_UUID);
    }
    if (actor.role === 'manager' && consultantId) {
      return eq(cases.consultantId, consultantId);
    }
    if (actor.role === 'client') return sql`false`;
    return undefined;
  }

  /** How many live cases sit at each stage, and how many of those have stalled. */
  async funnel(actor: AuthUser, consultantId?: string): Promise<FunnelResponse> {
    const scope = this.scope(actor, consultantId);

    // One pass over the cases in scope, grouped by status and stage: the live
    // pipeline is the 'active' groups, the outcomes are the totals of the
    // 'approved' and 'rejected' ones. Previously two scans of the same rows.
    const groups = await this.db
      .select({
        status: cases.status,
        stage: cases.currentStage,
        total: sql<number>`count(*)::int`,
        stuck: sql<number>`count(*) filter (where ${isStuckSql()})::int`,
      })
      .from(cases)
      .where(scope)
      .groupBy(cases.status, cases.currentStage);

    const byStage = new Map(
      groups.filter((r) => r.status === 'active' && r.stage !== 'closed').map((r) => [r.stage as Stage, r]),
    );
    const outcome = (status: string) =>
      groups.filter((r) => r.status === status).reduce((n, r) => n + r.total, 0);

    // Every stage appears, including the empty ones - a gap in the pipeline is
    // information, and a disappearing row makes the chart jump between loads.
    const stages: FunnelStage[] = STAGE_ORDER.filter((s) => s !== 'closed').map((s) => ({
      stage: s,
      label: STAGE_DEFINITIONS[s].label,
      clientLabel: STAGE_DEFINITIONS[s].clientLabel,
      total: byStage.get(s)?.total ?? 0,
      stuck: byStage.get(s)?.stuck ?? 0,
    }));

    return {
      stages,
      totalActive: stages.reduce((n, s) => n + s.total, 0),
      totalStuck: stages.reduce((n, s) => n + s.stuck, 0),
      approved: outcome('approved'),
      rejected: outcome('rejected'),
    };
  }

  /** Cases past their stage's threshold, worst first. */
  async stuckCases(
    actor: AuthUser,
    opts: { page: number; pageSize: number; consultantId?: string },
  ): Promise<Paginated<StuckCase>> {
    const where = and(
      eq(cases.status, 'active'),
      ne(cases.currentStage, 'closed'),
      isStuckSql(),
      this.scope(actor, opts.consultantId),
    );

    const countQuery = this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(cases)
      .where(where);

    const pendingDocsSql = sql<number>`(
      select count(*)::int from documents d
      where (d.case_id = ${cases.id} or (d.case_id is null and d.client_id = ${cases.clientId}))
        and d.status in ('pending', 'under_review') and d.deleted_at is null and d.trashed_at is null and d.superseded_by is null
    )`;

    const [[totalRow], rows] = await Promise.all([countQuery, this.db
      .select({
        id: cases.id,
        reference: cases.reference,
        clientId: cases.clientId,
        clientName: clients.fullName,
        consultantId: cases.consultantId,
        consultantName: users.fullName,
        targetCountry: cases.targetCountry,
        currentStage: cases.currentStage,
        currentStageName: cases.currentStageName,
        stageEnteredAt: cases.stageEnteredAt,
        daysInStage: sql<number>`extract(day from (now() - ${cases.stageEnteredAt}))::int`,
        daysOverdue: daysOverdueSql(),
        pendingDocuments: pendingDocsSql,
      })
      .from(cases)
      .innerJoin(clients, eq(clients.id, cases.clientId))
      .leftJoin(consultants, eq(consultants.id, cases.consultantId))
      .leftJoin(users, eq(users.id, consultants.userId))
      .where(where)
      .orderBy(desc(daysOverdueSql()))
      .limit(opts.pageSize)
      .offset((opts.page - 1) * opts.pageSize)]);
    const total = totalRow?.n ?? 0;

    return {
      items: rows.map((r) => ({
        ...r,
        currentStage: r.currentStage as Stage,
        stageEnteredAt: iso(r.stageEnteredAt),
        daysInStage: r.daysInStage ?? 0,
        daysOverdue: r.daysOverdue ?? 0,
        pendingDocuments: r.pendingDocuments ?? 0,
      })),
      page: opts.page,
      pageSize: opts.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / opts.pageSize)),
    };
  }

  /**
   * The consultancy-wide audit feed. Managers only - this is the record that
   * settles disputes, and it deliberately shows everyone's actions within the
   * consultancy, and nobody's outside it.
   */
  async auditPeople(actor: AuthUser): Promise<{ id: string; name: string; role: string; active: boolean }[]> {
    const rows = await this.db
      .select({ id: users.id, name: users.fullName, role: users.role, active: users.isActive })
      .from(users)
      .where(and(eq(users.tenantId, tenantOf(actor)), sql`${users.role} in ('manager', 'consultant')`))
      .orderBy(users.fullName);
    return rows.map((r) => ({ ...r, role: r.role as string }));
  }

  async auditFeed(actor: AuthUser, opts: {
    page: number;
    pageSize: number;
    caseId?: string;
    clientId?: string;
    actorId?: string;
    action?: string;
    /** One of AUDIT_CATEGORIES - the actions whose prefix it names. */
    category?: string;
    /** Inclusive calendar days, YYYY-MM-DD. */
    from?: string;
    to?: string;
    /** Free text over the client's name, the actor's name and the IP address. */
    q?: string;
    /** What the event was about - a person, for "changes made to Sana's access". */
    entityId?: string;
  }) {
    const conditions: (SQL | undefined)[] = [eq(auditLog.tenantId, tenantOf(actor))];
    if (opts.caseId) conditions.push(eq(auditLog.caseId, opts.caseId));
    if (opts.clientId) conditions.push(eq(auditLog.clientId, opts.clientId));
    if (opts.actorId) conditions.push(eq(auditLog.actorId, opts.actorId));
    if (opts.action) conditions.push(eq(auditLog.action, opts.action));
    if (opts.entityId) conditions.push(eq(auditLog.entityId, opts.entityId));
    const category = AUDIT_CATEGORIES.find((c) => c.key === opts.category);
    if (category) {
      conditions.push(
        sql`(${sql.join(
          category.prefixes.map((p) => sql`${auditLog.action} like ${`${p}%`}`),
          sql` or `,
        )})`,
      );
    }
    if (opts.from) conditions.push(sql`${auditLog.createdAt} >= ${opts.from}::date`);
    if (opts.to) conditions.push(sql`${auditLog.createdAt} < (${opts.to}::date + 1)`);
    if (opts.q) {
      const term = `%${opts.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      conditions.push(
        sql`(${clients.fullName} ilike ${term} or ${users.fullName} ilike ${term} or ${auditLog.ipAddress} ilike ${term})`,
      );
    }
    const where = and(...conditions.filter(Boolean));

    const countQuery = this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .leftJoin(clients, eq(clients.id, auditLog.clientId))
      .where(where);

    const [[totalRow], rows] = await Promise.all([countQuery, this.db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        caseId: auditLog.caseId,
        clientId: auditLog.clientId,
        clientName: clients.fullName,
        actorId: auditLog.actorId,
        actorName: users.fullName,
        actorRole: auditLog.actorRole,
        metadata: auditLog.metadata,
        ipAddress: auditLog.ipAddress,
        userAgent: auditLog.userAgent,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .leftJoin(clients, eq(clients.id, auditLog.clientId))
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(opts.pageSize)
      .offset((opts.page - 1) * opts.pageSize)]);

    const total = totalRow?.n ?? 0;
    return {
      items: rows.map((r) => ({ ...r, createdAt: iso(r.createdAt) })),
      page: opts.page,
      pageSize: opts.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / opts.pageSize)),
    };
  }

  /**
   * Intake against outcomes, one point per month.
   *
   * Both series are counts of cases, deliberately: a chart that plotted clients
   * on one line and cases on another would invite a comparison between two
   * different things. Every month in the window is emitted even when it is
   * empty, so the axis does not stretch and squash between loads.
   */
  async trends(actor: AuthUser, months: number, consultantId?: string): Promise<TrendsResponse> {
    const scope = this.scope(actor, consultantId);
    const span = Math.min(24, Math.max(3, months));
    const since = startOfMonth(new Date());
    since.setUTCMonth(since.getUTCMonth() - (span - 1));

    const monthOf = (col: SQLWrapper) =>
      sql<string>`to_char(date_trunc('month', ${col}), 'YYYY-MM')`;

    // closed_at is the truth when it is set; a case marked terminal by an older
    // build without one falls back to when it was last touched.
    const decidedAt = sql`coalesce(${cases.closedAt}, ${cases.updatedAt})`;

    // New clients per month rides along here rather than in its own endpoint,
    // because the only thing that reads it is the sparkline on the "New
    // clients" card - which must be the same series as the figure above it.
    const clientScope = this.clientScope(actor, consultantId);

    // Three independent reads: issued together rather than one after the other.
    const [openedRows, decidedRows, clientRows] = await Promise.all([
      this.db
        .select({ period: monthOf(cases.createdAt), n: sql<number>`count(*)::int` })
        .from(cases)
        .where(and(sql`${cases.createdAt} >= ${since.toISOString()}`, scope))
        .groupBy(monthOf(cases.createdAt)),
      this.db
        .select({
          period: monthOf(decidedAt),
          approved: sql<number>`count(*) filter (where ${cases.status} = 'approved')::int`,
          rejected: sql<number>`count(*) filter (where ${cases.status} = 'rejected')::int`,
        })
        .from(cases)
        .where(
          and(
            sql`${decidedAt} >= ${since.toISOString()}`,
            sql`${cases.status} in ('approved', 'rejected')`,
            scope,
          ),
        )
        .groupBy(monthOf(decidedAt)),
      this.db
        .select({ period: monthOf(clients.createdAt), n: sql<number>`count(*)::int` })
        .from(clients)
        .where(
          and(
            sql`${clients.createdAt} >= ${since.toISOString()}`,
            eq(clients.archived, false),
            clientScope,
          ),
        )
        .groupBy(monthOf(clients.createdAt)),
    ]);

    const opened = new Map(openedRows.map((r) => [r.period, r.n]));
    const decided = new Map(decidedRows.map((r) => [r.period, r]));
    const joined = new Map(clientRows.map((r) => [r.period, r.n]));

    const points: TrendPoint[] = [];
    for (let i = 0; i < span; i++) {
      const d = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i, 1));
      const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      points.push({
        period,
        label: MONTH_LABEL[d.getUTCMonth()]!,
        opened: opened.get(period) ?? 0,
        approved: decided.get(period)?.approved ?? 0,
        rejected: decided.get(period)?.rejected ?? 0,
        newClients: joined.get(period) ?? 0,
      });
    }

    return {
      points,
      openedTotal: points.reduce((n, p) => n + p.opened, 0),
      approvedTotal: points.reduce((n, p) => n + p.approved, 0),
    };
  }

  /**
   * How the live pipeline is doing, as three mutually exclusive buckets.
   *
   * The split is by who is holding things up, because that is the only reading
   * a manager can act on: a stalled case needs chasing, a case with documents
   * sitting in the review queue needs one of us to open it, and everything else
   * is fine. Every active case lands in exactly one bucket, so the parts sum to
   * the whole and a proportional chart is honest.
   */
  async caseHealth(actor: AuthUser, consultantId?: string): Promise<CaseHealthResponse> {
    const pendingDocs = sql<number>`(
      select count(*)::int from documents d
      where (d.case_id = ${cases.id} or (d.case_id is null and d.client_id = ${cases.clientId}))
        and d.status in ('pending', 'under_review') and d.deleted_at is null and d.trashed_at is null and d.superseded_by is null
    )`;

    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        stalled: sql<number>`count(*) filter (where ${isStuckSql()})::int`,
        awaitingUs: sql<number>`count(*) filter (where not (${isStuckSql()}) and ${pendingDocs} > 0)::int`,
        onTrack: sql<number>`count(*) filter (where not (${isStuckSql()}) and ${pendingDocs} = 0)::int`,
      })
      .from(cases)
      .where(
        and(
          eq(cases.status, 'active'),
          ne(cases.currentStage, 'closed'),
          this.scope(actor, consultantId),
        ),
      );

    return {
      total: row?.total ?? 0,
      segments: [
        { key: 'on_track', label: 'On track', count: row?.onTrack ?? 0, tone: 'ok' },
        { key: 'awaiting_us', label: 'Waiting on us', count: row?.awaitingUs ?? 0, tone: 'warn' },
        { key: 'stalled', label: 'Stalled', count: row?.stalled ?? 0, tone: 'bad' },
      ],
    };
  }

  /**
   * Headline figures for the top of a dashboard.
   *
   * Only the *flow* metrics carry a change figure. "Active cases" and "stalled"
   * are stocks - a count of what is true right now - and a percentage against
   * an arbitrary window would read as a trend the number does not have. They
   * get a plain-language hint instead.
   */
  async kpis(actor: AuthUser, consultantId?: string): Promise<KpiResponse> {
    const scope = this.scope(actor, consultantId);
    const clientScope = this.clientScope(actor, consultantId);

    const window30 = sql`now() - interval '30 days'`;
    const window60 = sql`now() - interval '60 days'`;
    const decidedAt = sql`coalesce(${cases.closedAt}, ${cases.updatedAt})`;

    const [[live], [intake], [reviews]] = await Promise.all([
      this.db
      .select({
        active: sql<number>`count(*) filter (where ${cases.status} = 'active' and ${cases.currentStage} <> 'closed')::int`,
        stalled: sql<number>`count(*) filter (where ${cases.status} = 'active' and ${cases.currentStage} <> 'closed' and ${isStuckSql()})::int`,
        approvedAll: sql<number>`count(*) filter (where ${cases.status} = 'approved')::int`,
        approvedRecent: sql<number>`count(*) filter (where ${cases.status} = 'approved' and ${decidedAt} >= ${window30})::int`,
        approvedPrior: sql<number>`count(*) filter (where ${cases.status} = 'approved' and ${decidedAt} >= ${window60} and ${decidedAt} < ${window30})::int`,
      })
      .from(cases)
      .where(scope),

      this.db
      .select({
        recent: sql<number>`count(*) filter (where ${clients.createdAt} >= ${window30})::int`,
        prior: sql<number>`count(*) filter (where ${clients.createdAt} >= ${window60} and ${clients.createdAt} < ${window30})::int`,
      })
      .from(clients)
      .where(and(eq(clients.archived, false), clientScope)),

      this.db
      .select({
        pending: sql<number>`count(*) filter (where ${documents.status} in ('pending', 'under_review') and ${documents.supersededBy} is null)::int`,
        clearedRecent: sql<number>`count(*) filter (where ${documents.reviewedAt} >= ${window30})::int`,
        clearedPrior: sql<number>`count(*) filter (where ${documents.reviewedAt} >= ${window60} and ${documents.reviewedAt} < ${window30})::int`,
      })
      .from(documents)
      // By student: a document may belong to the student rather than one application.
      .innerJoin(clients, eq(clients.id, documents.clientId))
      .where(and(isNull(documents.deletedAt), isNull(documents.trashedAt), clientScope)),
    ]);

    return {
      activeCases: live?.active ?? 0,
      stalledCases: live?.stalled ?? 0,
      approvedAllTime: live?.approvedAll ?? 0,
      pendingReviews: reviews?.pending ?? 0,
      newClients30: intake?.recent ?? 0,
      newClientsDeltaPct: deltaPct(intake?.recent ?? 0, intake?.prior ?? 0),
      approved30: live?.approvedRecent ?? 0,
      approvedDeltaPct: deltaPct(live?.approvedRecent ?? 0, live?.approvedPrior ?? 0),
      documentsCleared30: reviews?.clearedRecent ?? 0,
      documentsClearedDeltaPct: deltaPct(reviews?.clearedRecent ?? 0, reviews?.clearedPrior ?? 0),
    };
  }

  /**
   * The recent-activity strip.
   *
   * A manager sees everything; a consultant sees only events on their own
   * cases. That is not the audit trail with a filter bolted on - the audit
   * trail is deliberately manager-only, because a consultant reading their
   * colleagues' actions is not oversight. This is a consultant watching their
   * own desk.
   */
  async activity(actor: AuthUser, limit: number) {
    const scope = and(
      eq(auditLog.tenantId, tenantOf(actor)),
      actor.role === 'consultant'
        ? sql`${auditLog.caseId} in (select id from cases where consultant_id = ${actor.consultantId ?? NIL_UUID})`
        : undefined,
    );

    const rows = await this.db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        caseId: auditLog.caseId,
        clientId: auditLog.clientId,
        clientName: clients.fullName,
        actorName: users.fullName,
        actorRole: auditLog.actorRole,
        metadata: auditLog.metadata,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .leftJoin(clients, eq(clients.id, auditLog.clientId))
      .where(scope)
      .orderBy(desc(auditLog.createdAt))
      .limit(Math.min(50, Math.max(1, limit)));

    return rows.map((r) => ({ ...r, createdAt: iso(r.createdAt) }));
  }

  /**
   * Every dated commitment coming up in the next `days` days, soonest first:
   * application and offer deadlines, visa appointments, travel dates, and
   * passports that will be too close to expiry for a visa. Overdue ones (up to
   * a week past) stay on the list - a missed deadline is the one that matters.
   */
  async deadlines(actor: AuthUser, days: number): Promise<DeadlineItem[]> {
    const span = Math.min(120, Math.max(1, days));
    const from = localIsoDateIn(-7);
    const to = localIsoDateIn(span);
    const live = and(eq(cases.status, 'active'), ne(cases.currentStage, 'closed'), this.scope(actor));

    const base = {
      caseId: cases.id,
      reference: cases.reference,
      clientId: cases.clientId,
      clientName: clients.fullName,
      consultantName: users.fullName,
      targetCountry: cases.targetCountry,
      targetUniversity: cases.targetUniversity,
    };
    const inWindow = (col: SQLWrapper) => sql<boolean>`(${col}::date between ${from} and ${to})`;
    const day = (col: SQLWrapper) => sql<string>`to_char(${col}, 'YYYY-MM-DD')`;
    // Flagged six months ahead, because most student visas need that much validity.
    const passportSoon = sql<boolean>`(${clients.passportExpiry} <= (current_date + interval '183 days'))`;

    // One pass over the live cases, each row saying which of its dates fall in
    // the window, instead of five scans with the same joins - one per kind.
    const found = await this.db
      .select({
        ...base,
        application: day(cases.applicationDeadline),
        applicationDue: inWindow(cases.applicationDeadline),
        offer: day(cases.offerDeadline),
        offerDue: inWindow(cases.offerDeadline),
        appointment: day(cases.visaAppointmentAt),
        appointmentDue: inWindow(cases.visaAppointmentAt),
        travel: day(cases.travelDate),
        travelDue: inWindow(cases.travelDate),
        passport: day(clients.passportExpiry),
        passportDue: passportSoon,
      })
      .from(cases)
      .innerJoin(clients, eq(clients.id, cases.clientId))
      .leftJoin(consultants, eq(consultants.id, cases.consultantId))
      .leftJoin(users, eq(users.id, consultants.userId))
      .where(
        and(
          live,
          or(
            inWindow(cases.applicationDeadline),
            inWindow(cases.offerDeadline),
            inWindow(cases.visaAppointmentAt),
            inWindow(cases.travelDate),
            passportSoon,
          ),
        ),
      );

    type Found = (typeof found)[number];
    type Row = {
      caseId: string;
      reference: string;
      clientId: string;
      clientName: string;
      consultantName: string | null;
      targetCountry: string;
      targetUniversity: string | null;
      date: string;
    };
    // The same rows, in the same order, that five separate queries returned.
    const of = (due: (r: Found) => boolean, date: (r: Found) => string): Row[] =>
      found.filter(due).map((r) => ({
        caseId: r.caseId,
        reference: r.reference,
        clientId: r.clientId,
        clientName: r.clientName,
        consultantName: r.consultantName,
        targetCountry: r.targetCountry,
        targetUniversity: r.targetUniversity,
        date: date(r),
      }));
    const application = of((r) => r.applicationDue === true, (r) => r.application);
    const offer = of((r) => r.offerDue === true, (r) => r.offer);
    const appointment = of((r) => r.appointmentDue === true, (r) => r.appointment);
    const travel = of((r) => r.travelDue === true, (r) => r.travel);
    const passport = of((r) => r.passportDue === true, (r) => r.passport);

    const tag = (rows: Row[], kind: DeadlineItem['kind']) => rows.map((r) => ({ ...r, kind }));
    const seen = new Set<string>();
    const all: DeadlineItem[] = [
      ...tag(application, 'application'),
      ...tag(offer, 'offer'),
      ...tag(appointment, 'visa_appointment'),
      ...tag(travel, 'travel'),
      // One passport warning per client, not one per application.
      ...tag(passport, 'passport').filter((r) => {
        if (seen.has(r.clientId)) return false;
        seen.add(r.clientId);
        return true;
      }),
    ];
    return all.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 100);
  }

  /** Where students are going, and how it turned out. */
  async destinations(actor: AuthUser): Promise<DestinationRow[]> {
    return this.db
      .select({
        country: cases.targetCountry,
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${cases.status} = 'active' and ${cases.currentStage} <> 'closed')::int`,
        approved: sql<number>`count(*) filter (where ${cases.status} = 'approved')::int`,
        rejected: sql<number>`count(*) filter (where ${cases.status} = 'rejected')::int`,
      })
      .from(cases)
      .where(this.scope(actor))
      .groupBy(cases.targetCountry)
      .orderBy(desc(sql`count(*)`));
  }

  /** Live applications per intake, so the September rush is visible in June. */
  async intakes(actor: AuthUser): Promise<{ intake: string; count: number }[]> {
    const rows = await this.db
      .select({ intake: cases.intake, count: sql<number>`count(*)::int` })
      .from(cases)
      .where(
        and(
          eq(cases.status, 'active'),
          ne(cases.currentStage, 'closed'),
          sql`${cases.intake} is not null`,
          this.scope(actor),
        ),
      )
      .groupBy(cases.intake);
    const rank = (s: string) => {
      const [term = '', year = '0'] = s.split(/\s+/);
      const t = ['spring', 'summer', 'fall', 'autumn', 'winter'].indexOf(term.toLowerCase());
      return Number(year) * 10 + (t < 0 ? 9 : t);
    };
    return rows
      .map((r) => ({ intake: r.intake ?? '', count: r.count }))
      .sort((a, b) => rank(a.intake) - rank(b.intake));
  }

  /** Where enquiries come from, and how many of each became an approved visa. */
  async sources(actor: AuthUser): Promise<{ source: string; clients: number; approved: number }[]> {
    const source = sql<string>`coalesce(${clients.leadSource}, 'unknown')`;
    return this.db
      .select({
        source,
        clients: sql<number>`count(*)::int`,
        approved: sql<number>`count(*) filter (where exists (
          select 1 from cases k where k.client_id = ${clients.id} and k.status = 'approved'
        ))::int`,
      })
      .from(clients)
      .leftJoin(consultants, eq(consultants.id, clients.assignedConsultantId))
      .where(this.clientScope(actor))
      .groupBy(source)
      .orderBy(desc(sql`count(*)`));
  }

  /** Documents waiting longest across the whole consultancy. */
  async oldestPendingReview(actor: AuthUser): Promise<number | null> {
    const [row] = await this.db
      .select({ oldest: sql<string | null>`min(${documents.uploadedAt})` })
      .from(documents)
      .innerJoin(clients, eq(clients.id, documents.clientId))
      .where(
        and(
          inArray(documents.status, ['pending', 'under_review']),
          isNull(documents.supersededBy),
          isNull(documents.deletedAt),
          isNull(documents.trashedAt),
          this.clientScope(actor),
        ),
      );

    if (!row?.oldest) return null;
    return Math.floor((Date.now() - new Date(row.oldest).getTime()) / 86_400_000);
  }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

