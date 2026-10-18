import { Controller, Get, Post, Query } from '@nestjs/common';
import type { AuthUser } from '@crm/shared';
import { CurrentUser, Roles } from '../auth/auth.guard';
import { AnalyticsService } from './analytics.service';
import { StuckSweepService } from './stuck-sweep.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { RequirePermission } from '../auth/permissions';

const page = (v?: string) => Math.max(1, Number(v) || 1);
const size = (v: string | undefined, def: number, max: number) =>
  Math.min(max, Math.max(1, Number(v) || def));
const uuidOrUndefined = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
const dateOrUndefined = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly sweeper: StuckSweepService,
  ) {}

  /** Consultants get their own funnel; managers get the whole consultancy. */
  @Roles('consultant', 'manager')
  @Get('funnel')
  funnel(@CurrentUser() actor: AuthUser, @Query('consultantId') consultantId?: string) {
    return this.analytics.funnel(actor, consultantId);
  }

  /**
   * Run the stuck-case sweep now instead of waiting for the morning.
   *
   * Manager-only, and safe to call repeatedly: the sweep raises at most one
   * alert per case per stalling episode, so a second call in the same minute
   * writes nothing. Exists so the behaviour can be demonstrated and tested
   * without moving the clock, and so a scheduler outside the process can drive
   * it in a multi-instance deployment.
   */
  @Roles('manager')
  @Post('stuck/sweep')
  async sweepStuck(@CurrentUser() actor: AuthUser) {
    // Only the caller's own consultancy: a manager nudging their team must not
    // raise alerts in anyone else's.
    const raised = await this.sweeper.sweep(tenantOf(actor));
    return { raised };
  }

  /** Cases opened against cases approved, one point per month. */
  @Roles('consultant', 'manager')
  @Get('trends')
  trends(
    @CurrentUser() actor: AuthUser,
    @Query('months') months?: string,
    @Query('consultantId') consultantId?: string,
  ) {
    return this.analytics.trends(actor, Number(months) || 6, consultantId);
  }

  /** The live pipeline split by who is holding each case up. */
  @Roles('consultant', 'manager')
  @Get('health')
  health(@CurrentUser() actor: AuthUser, @Query('consultantId') consultantId?: string) {
    return this.analytics.caseHealth(actor, consultantId);
  }

  /** Headline figures, with a change figure on the flow metrics only. */
  @Roles('consultant', 'manager')
  @Get('kpis')
  kpis(@CurrentUser() actor: AuthUser, @Query('consultantId') consultantId?: string) {
    return this.analytics.kpis(actor, consultantId);
  }

  /**
   * Recent activity, scoped to what the caller may see. Distinct from
   * `/audit`, which is the whole-consultancy record and stays manager-only.
   */
  @Roles('consultant', 'manager')
  @Get('activity')
  activity(@CurrentUser() actor: AuthUser, @Query('limit') limit?: string) {
    return this.analytics.activity(actor, Number(limit) || 8);
  }

  @Roles('consultant', 'manager')
  @Get('deadlines')
  deadlines(@CurrentUser() actor: AuthUser, @Query('days') days?: string) {
    return this.analytics.deadlines(actor, Number(days) || 30);
  }

  @Roles('consultant', 'manager')
  @Get('destinations')
  destinations(@CurrentUser() actor: AuthUser) {
    return this.analytics.destinations(actor);
  }

  @Roles('consultant', 'manager')
  @Get('intakes')
  intakes(@CurrentUser() actor: AuthUser) {
    return this.analytics.intakes(actor);
  }

  @Roles('manager')
  @Get('sources')
  sources(@CurrentUser() actor: AuthUser) {
    return this.analytics.sources(actor);
  }

  @Roles('consultant', 'manager')
  @Get('stuck')
  stuck(
    @CurrentUser() actor: AuthUser,
    @Query('page') p?: string,
    @Query('pageSize') ps?: string,
    @Query('consultantId') consultantId?: string,
  ) {
    return this.analytics.stuckCases(actor, {
      page: page(p),
      pageSize: size(ps, 25, 100),
      consultantId,
    });
  }

  /**
   * The full audit trail: managers, and consultants a manager has explicitly
   * given "see the audit trail". It is the record of everyone's actions, so it
   * is never on by default.
   */
  /** The consultancy's staff, for the trail's "who" filter - including anyone switched off. */
  @Roles('consultant', 'manager')
  @RequirePermission('audit.view')
  @Get('audit/people')
  auditPeople(@CurrentUser() actor: AuthUser) {
    return this.analytics.auditPeople(actor);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('audit.view')
  @Get('audit')
  audit(
    @CurrentUser() actor: AuthUser,
    @Query('page') p?: string,
    @Query('pageSize') ps?: string,
    @Query('caseId') caseId?: string,
    @Query('clientId') clientId?: string,
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('category') category?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('entityId') entityId?: string,
  ) {
    return this.analytics.auditFeed(actor, {
      page: page(p),
      pageSize: size(ps, 50, 100),
      caseId: uuidOrUndefined(caseId),
      clientId: uuidOrUndefined(clientId),
      actorId: uuidOrUndefined(actorId),
      action,
      category,
      from: dateOrUndefined(from),
      to: dateOrUndefined(to),
      q: q?.trim().slice(0, 100) || undefined,
      entityId: uuidOrUndefined(entityId),
    });
  }
}
