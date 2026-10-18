import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  agreementSchema,
  agreementStatus,
  bpToPercent,
  caseEnrolmentSchema,
  institutionSchema,
  percentToBp,
  type AgreementInput,
  type AgreementView,
  type AuthUser,
  type CaseEnrolmentInput,
  type CommissionRuleView,
  type Currency,
  type InstitutionInput,
  type InstitutionSummaryView,
  type InstitutionType,
  type InstitutionView,
  type InstitutionsQuery,
  type Stage,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { cases, commissionAgreements, commissionRules, commissions, institutionContacts, institutions } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { staffCan } from '../auth/permissions';
import { isUniqueViolation, today } from '../common/db-helpers';
import { STORAGE, type StorageDriver } from '../storage/storage.driver';
import { DocumentsService } from '../documents/documents.service';
import { CasesService } from '../cases/cases.service';

type AgreementRow = typeof commissionAgreements.$inferSelect;
type RuleRow = typeof commissionRules.$inferSelect;

/**
 * The institutions a consultancy sends students to, the people there, and
 * the agreements that say what commission they pay. Every member of staff
 * can read the catalogue (to pick an institution on an application);
 * changing it needs "Manage universities".
 */
@Injectable()
export class InstitutionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
    private readonly cases: CasesService,
  ) {}

  private assertStaff(actor: AuthUser): void {
    if (actor.role !== 'manager' && actor.role !== 'consultant') throw new ForbiddenException('Only staff can see the institution catalogue.');
  }

  private assertManage(actor: AuthUser): void {
    if (!staffCan(actor, 'institution.manage')) throw new ForbiddenException('You do not have permission to manage universities.');
  }

  async list(actor: AuthUser, q: InstitutionsQuery): Promise<InstitutionSummaryView[]> {
    this.assertStaff(actor);
    const tenantId = tenantOf(actor);
    const conds: (SQL | undefined)[] = [eq(institutions.tenantId, tenantId)];
    if (!q.includeInactive) conds.push(eq(institutions.active, true));
    if (q.q) conds.push(ilike(institutions.name, `%${q.q}%`));
    if (q.country) conds.push(eq(sql`lower(${institutions.country})`, q.country.toLowerCase()));
    const rows = await this.db.select().from(institutions).where(and(...conds)).orderBy(asc(institutions.name)).limit(500);
    return this.summaries(tenantId, rows, staffCan(actor, 'commission.view'));
  }

  async get(actor: AuthUser, id: string): Promise<InstitutionView> {
    this.assertStaff(actor);
    const tenantId = tenantOf(actor);
    const row = await this.find(tenantId, id);
    const [summary] = await this.summaries(tenantId, [row], staffCan(actor, 'commission.view'));
    const [contacts, agreements] = await Promise.all([
      this.db.select().from(institutionContacts).where(eq(institutionContacts.institutionId, id)).orderBy(asc(institutionContacts.position)),
      this.agreements(tenantId, [id]),
    ]);
    return {
      ...summary!,
      website: row.website,
      notes: row.notes,
      contacts: contacts.map((c) => ({ id: c.id, name: c.name, role: c.role, email: c.email, phone: c.phone, primary: c.primary })),
      // Commission terms are for those who may see commissions.
      agreements: staffCan(actor, 'commission.view') || staffCan(actor, 'institution.manage') ? agreements : [],
    };
  }

  async save(actor: AuthUser, raw: InstitutionInput, id?: string): Promise<InstitutionView> {
    this.assertManage(actor);
    const input = institutionSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const values = {
      name: input.name,
      country: input.country,
      city: input.city,
      type: input.type,
      website: input.website,
      currency: input.currency,
      aggregator: input.aggregator,
      notes: input.notes,
      active: input.active,
      updatedAt: new Date(),
    };
    let saved: string;
    try {
      saved = await this.db.transaction(async (tx) => {
        let rowId = id;
        if (id) {
          const [r] = await tx.update(institutions).set(values).where(and(eq(institutions.id, id), eq(institutions.tenantId, tenantId))).returning({ id: institutions.id });
          if (!r) throw new NotFoundException('Institution not found.');
        } else {
          const [r] = await tx.insert(institutions).values({ tenantId, createdBy: actor.id, ...values }).returning({ id: institutions.id });
          rowId = r!.id;
        }
        await tx.delete(institutionContacts).where(eq(institutionContacts.institutionId, rowId!));
        if (input.contacts.length) {
          await tx.insert(institutionContacts).values(
            input.contacts.map((c, position) => ({ tenantId, institutionId: rowId!, name: c.name, role: c.role, email: c.email ?? null, phone: c.phone, primary: c.primary, position })),
          );
        }
        return rowId!;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new BadRequestException({ message: 'There is already an institution with that name.', fieldErrors: { name: 'Already in the catalogue' } });
      throw err;
    }
    await this.audit.record(actor, { action: 'institution.saved', entityType: 'institution', entityId: saved, metadata: { name: input.name, country: input.country, currency: input.currency } });
    return this.get(actor, saved);
  }

  /* ---------------------------------------------------------------- */
  /* Agreements                                                        */
  /* ---------------------------------------------------------------- */

  async saveAgreement(actor: AuthUser, institutionId: string, raw: AgreementInput, id?: string): Promise<AgreementView> {
    this.assertManage(actor);
    const input = agreementSchema.parse(raw);
    const tenantId = tenantOf(actor);
    await this.find(tenantId, institutionId);
    const agreementId = await this.db.transaction(async (tx) => {
      const values = {
        title: input.title,
        reference: input.reference,
        validFrom: input.validFrom,
        validTo: input.validTo ?? null,
        currency: input.currency,
        claimAfterDays: input.claimAfterDays,
        paymentTermsDays: input.paymentTermsDays,
        notes: input.notes,
        active: input.active,
        updatedAt: new Date(),
      };
      let rowId = id;
      if (id) {
        const [current] = await tx.select().from(commissionAgreements).where(and(eq(commissionAgreements.id, id), eq(commissionAgreements.tenantId, tenantId), eq(commissionAgreements.institutionId, institutionId))).limit(1);
        if (!current) throw new NotFoundException('Agreement not found.');
        const [used] = await tx.select({ n: sql<number>`count(*)::int` }).from(commissions).where(eq(commissions.agreementId, id));
        if ((used?.n ?? 0) > 0 && current.currency !== input.currency) {
          throw new BadRequestException({ message: 'Commissions have been earned under this agreement, so its currency cannot change. Start a new agreement instead.', fieldErrors: { currency: 'In use' } });
        }
        await tx.update(commissionAgreements).set({ ...values, version: sql`${commissionAgreements.version} + 1` }).where(eq(commissionAgreements.id, id));
        // Commissions keep a copy of the rule they were worked out under, so
        // replacing the rules changes nothing already earned.
        await tx.delete(commissionRules).where(eq(commissionRules.agreementId, id));
      } else {
        const [r] = await tx.insert(commissionAgreements).values({ tenantId, institutionId, createdBy: actor.id, ...values }).returning({ id: commissionAgreements.id });
        rowId = r!.id;
      }
      await tx.insert(commissionRules).values(
        input.rules.map((r, position) => ({
          tenantId,
          agreementId: rowId!,
          position,
          name: r.name,
          basis: r.basis,
          rateBp: percentToBp(r.ratePercent),
          fixedAmount: Math.round(r.fixedAmount * 100),
          years: r.years,
          yearCount: r.years === 'first_year' ? 1 : r.yearCount,
          tiers: r.tiers,
          bonusStudents: r.bonusStudents,
          bonusAmount: r.bonusAmount === null ? null : Math.round(r.bonusAmount * 100),
          conditions: r.conditions,
          retentionDays: r.retentionDays,
          triggerStage: r.triggerStage,
        })),
      );
      return rowId!;
    });
    await this.audit.record(actor, {
      action: 'institution_agreement.saved',
      entityType: 'agreement',
      entityId: agreementId,
      metadata: { institution: institutionId, title: input.title, validFrom: input.validFrom, validTo: input.validTo ?? null, rules: input.rules.length },
    });
    return (await this.agreements(tenantId, [institutionId])).find((a) => a.id === agreementId)!;
  }

  async attachAgreementDocument(actor: AuthUser, agreementId: string, file: { buffer: Buffer; originalname: string; size: number }): Promise<void> {
    this.assertManage(actor);
    const tenantId = tenantOf(actor);
    const [a] = await this.db.select().from(commissionAgreements).where(and(eq(commissionAgreements.id, agreementId), eq(commissionAgreements.tenantId, tenantId))).limit(1);
    if (!a) throw new NotFoundException('Agreement not found.');
    const valid = await this.documents.accept(actor, file);
    const key = `tenants/${tenantId}/agreements/${randomUUID()}`;
    await this.storage.put(key, valid.buffer, valid.mimeType);
    await this.db.update(commissionAgreements).set({ documentKey: key, documentName: valid.fileName, documentMime: valid.mimeType, updatedAt: new Date() }).where(eq(commissionAgreements.id, agreementId));
    await this.audit.record(actor, { action: 'institution_agreement.saved', entityType: 'agreement', entityId: agreementId, metadata: { document: valid.fileName } });
  }

  async agreementDocument(actor: AuthUser, agreementId: string): Promise<{ stream: Readable; name: string; mime: string }> {
    if (!staffCan(actor, 'commission.view') && !staffCan(actor, 'institution.manage')) throw new ForbiddenException();
    const [a] = await this.db.select().from(commissionAgreements).where(and(eq(commissionAgreements.id, agreementId), eq(commissionAgreements.tenantId, tenantOf(actor)))).limit(1);
    if (!a?.documentKey) throw new NotFoundException('No signed copy is attached.');
    return { stream: await this.storage.get(a.documentKey), name: a.documentName ?? 'agreement', mime: a.documentMime ?? 'application/octet-stream' };
  }

  /** Agreements with their rules, for some institutions. */
  async agreements(tenantId: string, institutionIds: string[]): Promise<AgreementView[]> {
    if (!institutionIds.length) return [];
    const rows = await this.db
      .select()
      .from(commissionAgreements)
      .where(and(eq(commissionAgreements.tenantId, tenantId), inArray(commissionAgreements.institutionId, institutionIds)))
      .orderBy(sql`${commissionAgreements.validFrom} desc`);
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [rules, counts] = await Promise.all([
      this.db.select().from(commissionRules).where(inArray(commissionRules.agreementId, ids)).orderBy(asc(commissionRules.position)),
      this.db
        .select({ agreementId: commissions.agreementId, n: sql<number>`count(distinct ${commissions.caseId})::int` })
        .from(commissions)
        .where(and(inArray(commissions.agreementId, ids), eq(commissions.kind, 'student'), inArray(commissions.status, ['confirmed', 'claimed', 'disputed', 'written_off', 'clawed_back'])))
        .groupBy(commissions.agreementId),
    ]);
    const countBy = new Map(counts.map((c) => [c.agreementId, c.n]));
    const day = today();
    return rows.map((a) => toAgreement(a, rules.filter((r) => r.agreementId === a.id), countBy.get(a.id) ?? 0, day));
  }

  /** The agreement in force for an institution on a day, with its rules. */
  async agreementOn(tenantId: string, institutionId: string, day: string): Promise<{ agreement: AgreementRow; rules: RuleRow[] } | null> {
    const [a] = await this.db
      .select()
      .from(commissionAgreements)
      .where(
        and(
          eq(commissionAgreements.tenantId, tenantId),
          eq(commissionAgreements.institutionId, institutionId),
          eq(commissionAgreements.active, true),
          sql`${commissionAgreements.validFrom} <= ${day}`,
          sql`(${commissionAgreements.validTo} is null or ${commissionAgreements.validTo} >= ${day})`,
        ),
      )
      .orderBy(sql`${commissionAgreements.validFrom} desc`)
      .limit(1);
    if (!a) return null;
    const rules = await this.db.select().from(commissionRules).where(eq(commissionRules.agreementId, a.id)).orderBy(asc(commissionRules.position));
    return { agreement: a, rules };
  }

  /* ---------------------------------------------------------------- */
  /* An application's institution and tuition                          */
  /* ---------------------------------------------------------------- */

  async setEnrolment(actor: AuthUser, caseId: string, raw: CaseEnrolmentInput) {
    if (!staffCan(actor, 'case.edit')) throw new ForbiddenException('You do not have permission to edit applications.');
    const input = caseEnrolmentSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const row = await this.cases.findAccessible(actor, caseId);
    let name: string | null = null;
    let currency: string | null = input.tuitionCurrency ?? null;
    if (input.institutionId) {
      const inst = await this.find(tenantId, input.institutionId);
      name = inst.name;
      currency = currency ?? inst.currency;
    }
    if ((input.scholarship ?? 0) > (input.tuitionFee ?? 0) && input.tuitionFee) {
      throw new BadRequestException({ message: 'The scholarship is more than the tuition.', fieldErrors: { scholarship: 'More than the tuition' } });
    }
    await this.db
      .update(cases)
      .set({
        institutionId: input.institutionId,
        // The catalogue name becomes the university on the application; what was typed before is replaced only when an institution is chosen.
        ...(name ? { targetUniversity: name } : {}),
        tuitionFee: input.tuitionFee ?? null,
        tuitionCurrency: input.tuitionFee ? currency : null,
        scholarship: input.scholarship ?? null,
        courseStart: input.courseStart ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(cases.id, caseId), eq(cases.tenantId, tenantId)));
    await this.audit.record(actor, {
      action: 'case.updated',
      entityType: 'case',
      entityId: caseId,
      caseId,
      clientId: row.case.clientId,
      metadata: { changed: ['institution', 'tuition'], institution: name, tuition: input.tuitionFee ?? null, courseStart: input.courseStart ?? null },
    });
    return this.cases.getDetail(actor, caseId);
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  async find(tenantId: string, id: string) {
    const [row] = await this.db.select().from(institutions).where(and(eq(institutions.id, id), eq(institutions.tenantId, tenantId))).limit(1);
    if (!row) throw new NotFoundException('Institution not found.');
    return row;
  }

  private async summaries(tenantId: string, rows: (typeof institutions.$inferSelect)[], money: boolean): Promise<InstitutionSummaryView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const yearStart = `${today().slice(0, 4)}-01-01`;
    const day = today();
    const [apps, amounts, active] = await Promise.all([
      this.db
        .select({ id: cases.institutionId, n: sql<number>`count(*)::int`, open: sql<number>`count(*) filter (where ${cases.status} in ('active','on_hold'))::int` })
        .from(cases)
        .where(and(eq(cases.tenantId, tenantId), inArray(cases.institutionId, ids)))
        .groupBy(cases.institutionId),
      money
        ? this.db.execute<{ id: string; outstanding: string; received_year: string }>(sql`
            select c.institution_id as id,
              coalesce(sum(case when c.status in ('confirmed','claimed','disputed') then c.amount - coalesce(r.received, 0) else 0 end), 0) as outstanding,
              coalesce(sum(coalesce(r.received_year, 0)), 0) as received_year
            from commissions c
            left join (
              select a.commission_id, sum(a.amount) as received,
                sum(a.amount) filter (where ir.received_on >= ${yearStart}) as received_year
              from receipt_allocations a join institution_receipts ir on ir.id = a.receipt_id
              where ir.voided_at is null and ir.tenant_id = ${tenantId}
              group by a.commission_id
            ) r on r.commission_id = c.id
            where c.tenant_id = ${tenantId} and c.institution_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
            group by c.institution_id`)
        : Promise.resolve(null),
      this.db
        .select({ id: commissionAgreements.id, institutionId: commissionAgreements.institutionId, title: commissionAgreements.title, validTo: commissionAgreements.validTo })
        .from(commissionAgreements)
        .where(
          and(
            eq(commissionAgreements.tenantId, tenantId),
            inArray(commissionAgreements.institutionId, ids),
            eq(commissionAgreements.active, true),
            sql`${commissionAgreements.validFrom} <= ${day}`,
            sql`(${commissionAgreements.validTo} is null or ${commissionAgreements.validTo} >= ${day})`,
          ),
        ),
    ]);
    const appBy = new Map(apps.map((a) => [a.id, a]));
    const moneyRows = amounts ? ((amounts as unknown as { rows?: { id: string; outstanding: string; received_year: string }[] }).rows ?? (amounts as unknown as { id: string; outstanding: string; received_year: string }[])) : [];
    const moneyBy = new Map(moneyRows.map((m) => [m.id, m]));
    return rows.map((r) => {
      const ag = active.find((a) => a.institutionId === r.id);
      return {
        id: r.id,
        name: r.name,
        country: r.country,
        city: r.city,
        type: r.type as InstitutionType,
        currency: r.currency as Currency,
        aggregator: r.aggregator,
        active: r.active,
        activeAgreement: ag ? { id: ag.id, title: ag.title, validTo: ag.validTo } : null,
        applications: appBy.get(r.id)?.n ?? 0,
        openApplications: appBy.get(r.id)?.open ?? 0,
        outstanding: Number(moneyBy.get(r.id)?.outstanding ?? 0),
        receivedThisYear: Number(moneyBy.get(r.id)?.received_year ?? 0),
      };
    });
  }
}

export function toRuleView(r: RuleRow): CommissionRuleView {
  return {
    id: r.id,
    position: r.position,
    name: r.name,
    basis: r.basis as 'percent' | 'fixed',
    ratePercent: bpToPercent(r.rateBp),
    fixedAmount: r.fixedAmount / 100,
    years: r.years as 'first_year' | 'each_year',
    yearCount: r.yearCount,
    tiers: r.tiers,
    bonusStudents: r.bonusStudents,
    bonusAmount: r.bonusAmount === null ? null : r.bonusAmount / 100,
    conditions: r.conditions,
    retentionDays: r.retentionDays,
    triggerStage: r.triggerStage as Stage,
  };
}

function toAgreement(a: AgreementRow, rules: RuleRow[], confirmed: number, day: string): AgreementView {
  return {
    id: a.id,
    institutionId: a.institutionId,
    title: a.title,
    reference: a.reference,
    validFrom: a.validFrom,
    validTo: a.validTo,
    currency: a.currency as Currency,
    claimAfterDays: a.claimAfterDays,
    paymentTermsDays: a.paymentTermsDays,
    notes: a.notes,
    active: a.active,
    status: agreementStatus(a, day),
    version: a.version,
    rules: rules.map(toRuleView),
    hasDocument: Boolean(a.documentKey),
    documentName: a.documentName,
    confirmedStudents: confirmed,
  };
}
