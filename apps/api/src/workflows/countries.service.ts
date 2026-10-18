import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, ilike, sql } from 'drizzle-orm';
import {
  countryFlag,
  normaliseCountry,
  type AuthUser,
  type CountriesQuery,
  type CountryData,
  type CountryInput,
  type CountryView,
} from '@crm/shared';
import { countrySchema } from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { cases, countries, requirementSets, workflowTemplates } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { iso, isUniqueViolation } from '../common/db-helpers';

type CountryRow = typeof countries.$inferSelect;

/**
 * Destination master data: what a consultancy knows about each country it
 * sends students to - intakes and their deadlines, fees, proof of funds,
 * language requirements, visa routes and processing times. Counsellors
 * read it; people who build workflows keep it current.
 */
@Injectable()
export class CountriesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, query: CountriesQuery): Promise<CountryView[]> {
    const tenantId = tenantOf(actor);
    const rows = await this.db
      .select()
      .from(countries)
      .where(
        and(
          eq(countries.tenantId, tenantId),
          query.includeInactive ? undefined : eq(countries.active, true),
          query.q ? ilike(countries.name, `%${query.q}%`) : undefined,
        ),
      )
      .orderBy(asc(countries.name));
    const usage = await this.usage(tenantId);
    return rows.map((r) => toView(r, usage));
  }

  async get(actor: AuthUser, id: string): Promise<CountryView> {
    const row = await this.find(actor, id);
    return toView(row, await this.usage(row.tenantId));
  }

  /** Destinations students are applying to that have no country record yet. */
  async unlisted(actor: AuthUser): Promise<{ name: string; caseCount: number }[]> {
    const tenantId = tenantOf(actor);
    const [known, used] = await Promise.all([
      this.db.select({ name: countries.name }).from(countries).where(eq(countries.tenantId, tenantId)),
      this.db
        .select({ name: cases.targetCountry, n: sql<number>`count(*)::int` })
        .from(cases)
        .where(eq(cases.tenantId, tenantId))
        .groupBy(cases.targetCountry),
    ]);
    const have = new Set(known.map((k) => normaliseCountry(k.name)));
    const out = new Map<string, { name: string; caseCount: number }>();
    for (const u of used) {
      const key = normaliseCountry(u.name);
      if (!key || have.has(key)) continue;
      const entry = out.get(key) ?? { name: u.name.trim(), caseCount: 0 };
      entry.caseCount += u.n;
      out.set(key, entry);
    }
    return [...out.values()].sort((a, b) => b.caseCount - a.caseCount);
  }

  async create(actor: AuthUser, input: CountryInput): Promise<CountryView> {
    const data = countrySchema.parse(input);
    let row: CountryRow | undefined;
    try {
      [row] = await this.db
        .insert(countries)
        .values({ tenantId: tenantOf(actor), ...columns(data), updatedBy: actor.id })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicate(data.name);
      throw err;
    }
    await this.audit.record(actor, { action: 'country.saved', entityType: 'country', entityId: row!.id, metadata: { name: data.name, created: true } });
    return this.get(actor, row!.id);
  }

  async update(actor: AuthUser, id: string, input: CountryInput): Promise<CountryView> {
    const current = await this.find(actor, id);
    const data = countrySchema.parse(input);
    try {
      await this.db
        .update(countries)
        .set({ ...columns(data), updatedBy: actor.id, updatedAt: new Date() })
        .where(eq(countries.id, id));
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicate(data.name);
      throw err;
    }
    const changed = (Object.keys(data) as (keyof CountryData)[]).filter(
      (k) => JSON.stringify(data[k] ?? null) !== JSON.stringify((current as Record<string, unknown>)[k] ?? null),
    );
    await this.audit.record(actor, { action: 'country.saved', entityType: 'country', entityId: id, metadata: { name: data.name, changed } });
    return this.get(actor, id);
  }

  private async find(actor: AuthUser, id: string): Promise<CountryRow> {
    const [row] = await this.db
      .select()
      .from(countries)
      .where(and(eq(countries.id, id), eq(countries.tenantId, tenantOf(actor))))
      .limit(1);
    if (!row) throw new NotFoundException('Country not found.');
    return row;
  }

  /** How much each destination is used, matched by name however it was typed. */
  private async usage(tenantId: string) {
    const [caseRows, workflowRows, checklistRows] = await Promise.all([
      this.db
        .select({
          name: cases.targetCountry,
          total: sql<number>`count(*)::int`,
          active: sql<number>`count(*) filter (where ${cases.status} = 'active' and ${cases.currentStage} <> 'closed')::int`,
        })
        .from(cases)
        .where(eq(cases.tenantId, tenantId))
        .groupBy(cases.targetCountry),
      this.db
        .select({ name: workflowTemplates.country, n: sql<number>`count(*)::int` })
        .from(workflowTemplates)
        .where(and(eq(workflowTemplates.tenantId, tenantId), sql`${workflowTemplates.archivedAt} is null`))
        .groupBy(workflowTemplates.country),
      this.db
        .select({ name: requirementSets.country, n: sql<number>`count(*)::int` })
        .from(requirementSets)
        .where(eq(requirementSets.tenantId, tenantId))
        .groupBy(requirementSets.country),
    ]);
    const add = (map: Map<string, number>, name: string | null, n: number) => {
      if (!name) return;
      const key = normaliseCountry(name);
      map.set(key, (map.get(key) ?? 0) + n);
    };
    const total = new Map<string, number>();
    const active = new Map<string, number>();
    const workflows = new Map<string, number>();
    const checklists = new Map<string, number>();
    for (const r of caseRows) {
      add(total, r.name, r.total);
      add(active, r.name, r.active);
    }
    for (const r of workflowRows) add(workflows, r.name, r.n);
    for (const r of checklistRows) add(checklists, r.name, r.n);
    return { total, active, workflows, checklists };
  }
}

function columns(d: CountryData) {
  return {
    name: d.name,
    code: d.code,
    active: d.active,
    currency: d.currency,
    intakes: d.intakes,
    fees: d.fees,
    proofOfFunds: d.proofOfFunds,
    languageRequirements: d.languageRequirements,
    visaTypes: d.visaTypes,
    visaProcessingDays: d.visaProcessingDays,
    workRights: d.workRights ?? null,
    postStudyWork: d.postStudyWork ?? null,
    notes: d.notes ?? null,
  };
}

function duplicate(name: string) {
  return new BadRequestException({ message: `${name} is already in your list.`, fieldErrors: { name: 'Already added' } });
}

function toView(r: CountryRow, usage: Awaited<ReturnType<CountriesService['usage']>>): CountryView {
  const key = normaliseCountry(r.name);
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    flag: countryFlag(r.code),
    active: r.active,
    currency: r.currency,
    intakes: r.intakes,
    fees: r.fees,
    proofOfFunds: r.proofOfFunds ?? null,
    languageRequirements: r.languageRequirements,
    visaTypes: r.visaTypes,
    visaProcessingDays: r.visaProcessingDays,
    workRights: r.workRights ?? undefined,
    postStudyWork: r.postStudyWork ?? undefined,
    notes: r.notes ?? undefined,
    caseCount: usage.total.get(key) ?? 0,
    activeCaseCount: usage.active.get(key) ?? 0,
    workflowCount: usage.workflows.get(key) ?? 0,
    checklistCount: usage.checklists.get(key) ?? 0,
    updatedAt: iso(r.updatedAt),
  };
}
