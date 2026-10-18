import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { STAGE_DEFINITIONS, type Stage } from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { cases, clients, consultants, notifications, tenants, users } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { AutomationService } from '../workflows/automation.service';

/**
 * Raises the `case_stuck` notification.
 *
 * This is the one alert that cannot be produced by the action that causes it,
 * because nothing happening *is* the cause. It needs a clock, so it gets one.
 *
 * Two rules make a daily sweep safe to run:
 *
 *  - **One alert per stalling episode, not per day.** A case is skipped if a
 *    `case_stuck` notification already exists for it since it entered its
 *    current stage. Moving the case and letting it stall again is a new
 *    episode and alerts again; leaving it stuck does not re-nag every morning.
 *    Without this the bell would fill with the same six cases every day and
 *    people would learn to ignore it, which is worse than no alert at all.
 *
 *  - **The thresholds come from the same config as everywhere else.** A case
 *    is stuck here exactly when the manager's dashboard says it is stuck.
 *
 * Concurrency note: with several API instances this timer runs once per
 * instance. The insert is idempotent per episode but the check is not atomic,
 * so a multi-instance deployment wants a single scheduler (a leader lock, or
 * an external trigger hitting POST /analytics/stuck/sweep on one instance)
 * rather than this timer running on every box.
 */
@Injectable()
export class StuckSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StuckSweepService.name);
  private timer: NodeJS.Timeout | null = null;

  /** 08:00 local: the alert is waiting when the office opens, not at 3am. */
  private static readonly HOUR = 8;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly notifications: NotificationsService,
    private readonly automation: AutomationService,
  ) {}

  onModuleInit(): void {
    this.scheduleNext();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * A self-rescheduling timer rather than a cron library.
   *
   * One daily job did not justify a dependency, and the obvious candidate is
   * ESM-only while this app is CommonJS. Each run books the next one, so a
   * long-running process does not drift and a restart simply re-books.
   *
   * `unref()` keeps this from holding the process open at shutdown.
   */
  private scheduleNext(): void {
    const now = new Date();
    const next = new Date(now);
    next.setHours(StuckSweepService.HOUR, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    this.timer = setTimeout(() => {
      void this.scheduledSweep().finally(() => this.scheduleNext());
    }, next.getTime() - now.getTime());
    this.timer.unref();

    this.logger.log(`Next stuck-case sweep at ${next.toISOString()}`);
  }

  private async scheduledSweep(): Promise<void> {
    try {
      const raised = await this.sweep();
      this.logger.log(`Stuck sweep raised ${raised} notification(s)`);
    } catch (err) {
      // A failed sweep must never take the process down; the dashboard still
      // shows the same cases on load, so the cost is a missed nudge.
      this.logger.error('Stuck sweep failed', err as Error);
    }
  }

  /**
   * Finds cases past the limit for their stage and notifies the people who can
   * do something about it: the assigned consultant, and every manager of the
   * same consultancy.
   *
   * The scheduled run covers every active consultancy; a manager triggering it
   * by hand passes their own tenant and touches nothing outside it. Suspended
   * consultancies are skipped - nobody there can sign in to read the alert.
   *
   * Returns how many notifications were written, so the endpoint and the log
   * can both report something truthful.
   */
  async sweep(tenantId?: string): Promise<number> {
    const branches = Object.values(STAGE_DEFINITIONS)
      .map((d) => `when '${d.key}' then interval '${d.stuckAfterDays} days'`)
      .join(' ');
    // The stage's own limit from its workflow; the built-in ones as fallback.
    const threshold = sql.raw(`coalesce(${cases.stageSlaDays.name} * interval '1 day', (case ${cases.currentStage.name} ${branches} end))`);

    const rows = await this.db
      .select({
        id: cases.id,
        tenantId: cases.tenantId,
        clientName: clients.fullName,
        currentStage: cases.currentStage,
        currentStageName: cases.currentStageName,
        stageSlaDays: cases.stageSlaDays,
        currentStageKey: cases.currentStageKey,
        stageEnteredAt: cases.stageEnteredAt,
        consultantUserId: users.id,
        daysInStage: sql<number>`extract(day from (now() - ${cases.stageEnteredAt}))::int`,
      })
      .from(cases)
      .innerJoin(tenants, eq(tenants.id, cases.tenantId))
      .innerJoin(clients, eq(clients.id, cases.clientId))
      .leftJoin(consultants, eq(consultants.id, cases.consultantId))
      .leftJoin(users, eq(users.id, consultants.userId))
      .where(
        and(
          eq(tenants.status, 'active'),
          tenantId ? eq(cases.tenantId, tenantId) : undefined,
          eq(cases.status, 'active'),
          ne(cases.currentStage, 'closed'),
          sql`${cases.stageEnteredAt} < now() - ${threshold}`,
          // The episode guard: nothing raised for this case since it entered
          // the stage it is currently sitting in.
          sql`not exists (
            select 1 from ${notifications} n
            where n.case_id = ${cases.id}
              and n.type = 'case_stuck'
              and n.created_at >= ${cases.stageEnteredAt}
          )`,
        ),
      );

    if (rows.length === 0) return 0;

    // Managers of the consultancies that actually have a stalled case, grouped
    // so each case only ever reaches its own consultancy's managers.
    const tenantIds = [...new Set(rows.map((r) => r.tenantId))];
    const managerRows = await this.db
      .select({ id: users.id, tenantId: users.tenantId })
      .from(users)
      .where(
        and(
          eq(users.role, 'manager'),
          eq(users.isActive, true),
          inArray(users.tenantId, tenantIds),
        ),
      );
    const managersByTenant = new Map<string, string[]>();
    for (const m of managerRows) {
      if (!m.tenantId) continue;
      managersByTenant.set(m.tenantId, [...(managersByTenant.get(m.tenantId) ?? []), m.id]);
    }

    let written = 0;

    for (const row of rows) {
      const def = STAGE_DEFINITIONS[row.currentStage as Stage];
      const title = `${row.clientName} has not moved in ${row.daysInStage} days`;
      const body = `Still at ${row.currentStageName ?? def.label}, past the ${row.stageSlaDays ?? def.stuckAfterDays}-day limit for this stage.`;

      // The consultant is told about their own case; managers are told about
      // every case, because catching this is the job the role exists for.
      //
      // The link is built per recipient. The two roles read the same case at
      // different paths, and sending a manager to /desk/... would bounce them
      // to their own home and lose the case they clicked on.
      const recipients = new Map<string, string>();
      for (const managerId of managersByTenant.get(row.tenantId) ?? []) {
        recipients.set(managerId, `/overview/cases/${row.id}`);
      }
      if (row.consultantUserId) recipients.set(row.consultantUserId, `/desk/cases/${row.id}`);

      for (const [userId, link] of recipients) {
        await this.notifications.push({
          userId,
          type: 'case_stuck',
          title,
          body,
          link,
          caseId: row.id,
        });
        written++;
      }

      // Automations listening for stalled applications - once per episode.
      await this.automation.fire({
        trigger: 'case_stuck',
        tenantId: row.tenantId,
        caseId: row.id,
        actor: null,
        stageKey: row.currentStageKey,
        eventKey: `stuck:${row.id}:${new Date(row.stageEnteredAt).toISOString()}`,
      });
    }

    return written;
  }
}
