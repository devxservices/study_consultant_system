import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  KYC_KINDS,
  STAGES,
  kycStatus,
  kycReviewSchema,
  partnerApplicationSchema,
  partnerBankSchema,
  partnerMemberCanManage,
  partnerMemberSchema,
  partnerSchema,
  partnerSettingsSchema,
  partnerStatusSchema,
  partnerTierSchema,
  tierFor,
  type AuthUser,
  type Currency,
  type KycKind,
  type Paginated,
  type PartnerAgreementStatus,
  type PartnerApplicationInput,
  type PartnerBankInput,
  type PartnerDocumentView,
  type PartnerInput,
  type PartnerKind,
  type PartnerMemberInput,
  type PartnerMemberRole,
  type PartnerMemberView,
  type PartnerPerformanceRow,
  type PartnerSettingsInput,
  type PartnerSettingsView,
  type PartnerStatus,
  type PartnerSummaryView,
  type PartnerTier,
  type PartnerView,
  type PartnersQuery,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import {
  cases,
  clients,
  commissions,
  consultants,
  partnerAgreements,
  partnerDocuments,
  partnerEarnings,
  partnerMembers,
  partnerSettings,
  partners,
  users,
} from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService, type MailAttachment } from '../mail/mail.service';
import { DocumentsService } from '../documents/documents.service';
import { STORAGE, type StorageDriver } from '../storage/storage.driver';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { tenantIdentity } from '../tenancy/tenant-links';
import { staffCan } from '../auth/permissions';
import { hashPassword } from '../auth/local-auth.provider';
import { open, seal } from '../auth/secret-box';
import { iso, isoOrNull, page, today, withDocumentNumber } from '../common/db-helpers';
import { permissionHolders } from '../common/permission-holders';

export type PartnerRow = typeof partners.$inferSelect;

const bp = (pct: number) => Math.round(pct * 100);
const pctOf = (b: number) => b / 100;
const NIL = '00000000-0000-0000-0000-000000000000';

/** Who a partner's member is, resolved once per request. */
export interface PartnerContext {
  partner: PartnerRow;
  role: PartnerMemberRole;
  canManage: boolean;
}

/** Enrolled: a student whose first-year university commission was confirmed. */
const ENROLLED = ['confirmed', 'claimed', 'disputed', 'written_off', 'clawed_back'];

/** The text new agreements start from, when the consultancy has not written its own. */
export const DEFAULT_AGREEMENT = `This agreement is between {consultancy} ("the Consultancy") and {partner} ("the Partner"), from {date}.

1. Appointment. The Consultancy appoints the Partner, on a non-exclusive basis, to introduce prospective students to it. The Partner is an independent contractor and not an employee, agent at law or representative of the Consultancy or of any university.

2. Registering students. The Partner registers each student through the partner portal, with the student's consent to their details being shared. A student belongs to the Partner who registers them first. Where a student is already known to the Consultancy, the Consultancy decides, and its decision is final.

3. Conduct. The Partner gives students accurate information about courses, fees, scholarships and visa requirements; does not guarantee admission or a visa; does not charge students fees the Consultancy has not agreed in writing; and complies with the law, including data protection law, and with the codes of conduct of the universities and countries concerned.

4. Documents. The Partner submits only genuine documents and tells the Consultancy at once of anything it knows or suspects to be false.

5. Commission. The Partner earns what the commission schedule in force says, as shown in the partner portal. Commission that depends on a university paying is earned only when, and to the extent that, the university pays. Commission is clawed back if the university claws back its own.

6. Payment. The Consultancy pays what is owed, less tax it must withhold and any advance it has made, by bank transfer to the account the Partner has registered, after receiving the Partner's registration papers.

7. Confidentiality. Each party keeps the other's confidential information, and students' personal data, confidential, and uses it only for this agreement.

8. Term and ending. Either party may end this agreement with 30 days' written notice, or at once for a serious breach. Commission earned on students registered before it ends remains payable under clause 5.

9. Law. This agreement is governed by the law of the country in which the Consultancy is established.`;

/**
 * Partners - sub-agents and referral partners. Staff with "See partners" read
 * them; "Manage partners" approves and changes them; "Pay partners" sees
 * their bank details and pays them.
 */
@Injectable()
export class PartnersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly documents: DocumentsService,
  ) {}

  assertView(actor: AuthUser): void {
    if (!staffCan(actor, 'partner.view')) throw new ForbiddenException('You do not have permission to see partners.');
  }

  assertManage(actor: AuthUser): void {
    if (!staffCan(actor, 'partner.manage')) throw new ForbiddenException('You do not have permission to manage partners.');
  }

  /* ---------------------------------------------------------------- */
  /* The partner a portal user acts for                                */
  /* ---------------------------------------------------------------- */

  async context(actor: AuthUser): Promise<PartnerContext> {
    if (actor.role !== 'partner' || !actor.partnerId) throw new ForbiddenException('This is for partners.');
    const [row] = await this.db
      .select({ p: partners, role: partnerMembers.role })
      .from(partnerMembers)
      .innerJoin(partners, eq(partners.id, partnerMembers.partnerId))
      .where(and(eq(partnerMembers.userId, actor.id), eq(partners.tenantId, tenantOf(actor))))
      .limit(1);
    if (!row || row.p.id !== actor.partnerId) throw new ForbiddenException('Your login is not linked to a partner.');
    if (row.p.status === 'terminated') throw new ForbiddenException('This partnership has ended.');
    const role = row.role as PartnerMemberRole;
    return { partner: row.p, role, canManage: partnerMemberCanManage(role) };
  }

  /** Registering students and the like needs an active partner. */
  assertActive(ctx: PartnerContext): void {
    if (ctx.partner.status !== 'active') {
      throw new ForbiddenException(
        ctx.partner.status === 'suspended' ? 'Your partnership is suspended. Contact the consultancy.' : 'Your partnership is not active yet. Finish your registration first.',
      );
    }
  }

  /* ---------------------------------------------------------------- */
  /* Reading                                                           */
  /* ---------------------------------------------------------------- */

  async list(actor: AuthUser, q: PartnersQuery): Promise<Paginated<PartnerSummaryView>> {
    this.assertView(actor);
    const tenantId = tenantOf(actor);
    const conds: (SQL | undefined)[] = [eq(partners.tenantId, tenantId)];
    if (q.status !== 'all') conds.push(eq(partners.status, q.status));
    if (q.tier) conds.push(eq(partners.tier, q.tier));
    if (q.q) conds.push(or(ilike(partners.name, `%${q.q}%`), ilike(partners.email, `%${q.q}%`), ilike(partners.contactName, `%${q.q}%`), ilike(partners.number, `%${q.q}%`)));
    const where = and(...conds);
    const [[count], rows] = await Promise.all([
      this.db.select({ n: sql<number>`count(*)::int` }).from(partners).where(where),
      this.db
        .select({ id: partners.id })
        .from(partners)
        .where(where)
        .orderBy(sql`case ${partners.status} when 'applied' then 0 when 'onboarding' then 1 when 'active' then 2 when 'suspended' then 3 else 4 end`, asc(partners.name))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
    ]);
    return page(await this.summaries(tenantId, rows.map((r) => r.id)), count?.n ?? 0, q.page, q.pageSize);
  }

  /** For pickers: every partner but the terminated, by name. */
  async options(actor: AuthUser): Promise<{ id: string; name: string; status: PartnerStatus; tier: PartnerTier; currency: Currency }[]> {
    this.assertView(actor);
    const rows = await this.db
      .select({ id: partners.id, name: partners.name, status: partners.status, tier: partners.tier, currency: partners.currency })
      .from(partners)
      .where(and(eq(partners.tenantId, tenantOf(actor)), ne(partners.status, 'terminated')))
      .orderBy(asc(partners.name));
    return rows.map((r) => ({ ...r, status: r.status as PartnerStatus, tier: r.tier as PartnerTier, currency: r.currency as Currency }));
  }

  async summaries(tenantId: string, ids: string[]): Promise<PartnerSummaryView[]> {
    if (!ids.length) return [];
    const manager = alias(users, 'manager');
    const parent = alias(partners, 'parent');
    const [rows, students, enrolled, payable, docs, agreements] = await Promise.all([
      this.db
        .select({ p: partners, managerName: manager.fullName, parentName: parent.name })
        .from(partners)
        .leftJoin(manager, eq(manager.id, partners.managerUserId))
        .leftJoin(parent, eq(parent.id, partners.parentPartnerId))
        .where(inArray(partners.id, ids)),
      this.db.select({ id: clients.partnerId, n: sql<number>`count(*)::int` }).from(clients).where(and(inArray(clients.partnerId, ids), eq(clients.archived, false))).groupBy(clients.partnerId),
      this.db
        .select({ id: clients.partnerId, n: sql<number>`count(distinct ${clients.id})::int` })
        .from(commissions)
        .innerJoin(clients, eq(clients.id, commissions.clientId))
        .where(and(inArray(clients.partnerId, ids), eq(commissions.kind, 'student'), eq(commissions.yearNo, 1), inArray(commissions.status, ENROLLED)))
        .groupBy(clients.partnerId),
      this.db
        .select({ id: partnerEarnings.partnerId, currency: partnerEarnings.currency, n: sql<string>`sum(${partnerEarnings.amount})` })
        .from(partnerEarnings)
        .where(and(inArray(partnerEarnings.partnerId, ids), eq(partnerEarnings.status, 'payable')))
        .groupBy(partnerEarnings.partnerId, partnerEarnings.currency),
      this.db.select({ id: partnerDocuments.partnerId, kind: partnerDocuments.kind, status: partnerDocuments.status }).from(partnerDocuments).where(inArray(partnerDocuments.partnerId, ids)),
      this.db
        .selectDistinctOn([partnerAgreements.partnerId], { id: partnerAgreements.partnerId, status: partnerAgreements.status })
        .from(partnerAgreements)
        .where(and(inArray(partnerAgreements.partnerId, ids), ne(partnerAgreements.status, 'void')))
        .orderBy(partnerAgreements.partnerId, desc(partnerAgreements.version)),
    ]);
    const byId = new Map(rows.map((r) => [r.p.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => ({
        id: r.p.id,
        number: r.p.number,
        name: r.p.name,
        kind: r.p.kind as PartnerKind,
        status: r.p.status as PartnerStatus,
        tier: r.p.tier as PartnerTier,
        country: r.p.country,
        city: r.p.city,
        contactName: r.p.contactName,
        email: r.p.email,
        managerName: r.managerName,
        parentName: r.parentName,
        students: students.find((s) => s.id === r.p.id)?.n ?? 0,
        enrolled: enrolled.find((s) => s.id === r.p.id)?.n ?? 0,
        payable: payable.filter((p) => p.id === r.p.id && Number(p.n) !== 0).map((p) => ({ currency: p.currency as Currency, amount: Number(p.n) })),
        kycStatus: kycStatus(docs.filter((d) => d.id === r.p.id).map((d) => ({ kind: d.kind as KycKind, status: d.status as 'pending' | 'approved' | 'rejected' }))),
        agreementStatus: (agreements.find((a) => a.id === r.p.id)?.status as PartnerAgreementStatus | undefined) ?? null,
        createdAt: iso(r.p.createdAt),
      }));
  }

  async get(actor: AuthUser, id: string): Promise<PartnerView> {
    this.assertView(actor);
    return this.view(tenantOf(actor), id, staffCan(actor, 'payout.manage'));
  }

  async view(tenantId: string, id: string, showBank: boolean): Promise<PartnerView> {
    const p = await this.find(tenantId, id);
    const approver = alias(users, 'approver');
    const uploader = alias(users, 'uploader');
    const reviewer = alias(users, 'reviewer');
    const [[summary], [approved], subAgents, members, docs, settings] = await Promise.all([
      this.summaries(tenantId, [id]),
      p.approvedBy ? this.db.select({ name: approver.fullName }).from(approver).where(eq(approver.id, p.approvedBy)) : Promise.resolve([] as { name: string }[]),
      this.db.select({ id: partners.id, name: partners.name, status: partners.status }).from(partners).where(eq(partners.parentPartnerId, id)).orderBy(asc(partners.name)),
      this.members(id),
      this.db
        .select({ d: partnerDocuments, uploadedByName: uploader.fullName, reviewedByName: reviewer.fullName })
        .from(partnerDocuments)
        .leftJoin(uploader, eq(uploader.id, partnerDocuments.uploadedBy))
        .leftJoin(reviewer, eq(reviewer.id, partnerDocuments.reviewedBy))
        .where(eq(partnerDocuments.partnerId, id))
        .orderBy(desc(partnerDocuments.createdAt)),
      this.settings(tenantId),
    ]);
    let bank: PartnerView['bank'] = null;
    if (p.bankSealed) {
      try {
        const b = JSON.parse(open(p.bankSealed)) as { accountTitle: string; bankName: string; iban: string; swift: string | null };
        bank = showBank ? b : { ...b, iban: `•••• ${b.iban.slice(-4)}`, swift: b.swift ? '••••' : null };
      } catch {
        bank = null;
      }
    }
    return {
      ...summary!,
      phone: p.phone,
      address: p.address,
      website: p.website,
      registrationNumber: p.registrationNumber,
      taxId: p.taxId,
      managerUserId: p.managerUserId,
      parentPartnerId: p.parentPartnerId,
      overridePercent: pctOf(p.overrideBp),
      withholdingPercent: p.withholdingBp === null ? null : pctOf(p.withholdingBp),
      effectiveWithholdingPercent: pctOf(p.withholdingBp ?? bp(settings.defaultWithholdingPercent)),
      currency: p.currency as Currency,
      source: p.source as 'applied' | 'added',
      application: p.application ?? null,
      notes: p.notes,
      bank,
      approvedAt: isoOrNull(p.approvedAt),
      approvedByName: approved?.name ?? null,
      subAgents: subAgents.map((s) => ({ ...s, status: s.status as PartnerStatus })),
      members,
      documents: docs.map((r) => this.docView(r.d, r.uploadedByName, r.reviewedByName)),
    };
  }

  private docView(d: typeof partnerDocuments.$inferSelect, uploadedByName: string | null, reviewedByName: string | null): PartnerDocumentView {
    return {
      id: d.id,
      kind: d.kind as KycKind,
      name: d.name,
      size: d.size,
      status: d.status as PartnerDocumentView['status'],
      reviewNote: d.reviewNote,
      uploadedByName,
      reviewedByName,
      createdAt: iso(d.createdAt),
    };
  }

  async members(partnerId: string): Promise<PartnerMemberView[]> {
    const rows = await this.db
      .select({ m: partnerMembers, u: users })
      .from(partnerMembers)
      .innerJoin(users, eq(users.id, partnerMembers.userId))
      .where(eq(partnerMembers.partnerId, partnerId))
      .orderBy(sql`case ${partnerMembers.role} when 'owner' then 0 when 'admin' then 1 else 2 end`, asc(users.fullName));
    return rows.map((r) => ({
      id: r.m.id,
      userId: r.u.id,
      fullName: r.u.fullName,
      email: r.u.email,
      phone: r.u.phone,
      role: r.m.role as PartnerMemberRole,
      active: r.u.isActive,
      lastSeenAt: isoOrNull(r.u.lastSignInAt),
      createdAt: iso(r.m.createdAt),
    }));
  }

  async find(tenantId: string, id: string): Promise<PartnerRow> {
    const [row] = await this.db.select().from(partners).where(and(eq(partners.id, id), eq(partners.tenantId, tenantId))).limit(1);
    if (!row) throw new NotFoundException('Partner not found.');
    return row;
  }

  /* ---------------------------------------------------------------- */
  /* Applying and adding                                               */
  /* ---------------------------------------------------------------- */

  /** The public "become a partner" form. Says the same thing whether or not the email is new. */
  async apply(tenantId: string, raw: PartnerApplicationInput): Promise<{ ok: true }> {
    const input = partnerApplicationSchema.parse(raw);
    const settings = await this.settings(tenantId);
    if (!settings.applicationsOpen) throw new ForbiddenException('Partner applications are closed at the moment.');
    const [existing] = await this.db
      .select({ id: partners.id })
      .from(partners)
      .where(and(eq(partners.tenantId, tenantId), eq(sql`lower(${partners.email})`, input.email.toLowerCase())))
      .limit(1);
    if (existing) return { ok: true };
    const currency = await this.baseCurrency(tenantId);
    const created = await withDocumentNumber(this.db, partners, tenantId, 'PTR', async (number) => {
      try {
        const [row] = await this.db
        .insert(partners)
        .values({
          tenantId,
          number,
          name: input.name,
          kind: input.kind,
          status: 'applied',
          contactName: input.contactName,
          email: input.email,
          phone: input.phone,
          country: input.country,
          city: input.city,
          website: input.website,
          source: 'applied',
          application: { studentsPerYear: input.studentsPerYear ?? null, message: input.message },
          currency,
        })
        .returning();
        return row!;
      } catch (err) {
        // Applied twice at once: the first one stands.
        if (isEmailClash(err)) return null;
        throw err;
      }
    });
    if (!created) return { ok: true };
    await this.audit.record(null, { tenantId, action: 'partner.applied', entityType: 'partner', entityId: created.id, metadata: { name: created.name, email: created.email } });
    const holders = await permissionHolders(this.db, tenantId, 'partner.manage');
    await this.notifications.pushMany(holders, {
      type: 'partner_applied',
      title: `${created.name} applied to become a partner`,
      body: `${created.contactName}, ${created.country}${input.studentsPerYear ? ` - about ${input.studentsPerYear} students a year` : ''}.`,
      link: `/overview/partners/${created.id}`,
      email: true,
    });
    const site = await tenantIdentity(this.db, tenantId);
    await this.mail.send({
      to: created.email,
      fromName: site.name,
      replyTo: site.contactEmail ?? undefined,
      subject: `Your partner application to ${site.name}`,
      text: `Dear ${created.contactName},\n\nThank you for applying to become a partner of ${site.name}. We have your application (${created.number}) and will be in touch about the next steps: your registration papers and the partner agreement.\n\n${site.name}`,
    });
    return { ok: true };
  }

  async create(actor: AuthUser, raw: PartnerInput): Promise<PartnerView> {
    this.assertManage(actor);
    const input = partnerSchema.parse(raw);
    const tenantId = tenantOf(actor);
    await this.checkLinks(tenantId, input, null);
    const created = await withDocumentNumber(this.db, partners, tenantId, 'PTR', async (number) => {
      try {
        const [row] = await this.db
          .insert(partners)
          .values({ tenantId, number, ...this.columns(input), status: 'onboarding', source: 'added', createdBy: actor.id })
          .returning();
        return row!;
      } catch (err) {
        if (isEmailClash(err)) throw new ConflictException({ message: 'Another partner uses that email.', fieldErrors: { email: 'Already a partner' } });
        throw err;
      }
    });
    await this.audit.record(actor, { action: 'partner.saved', entityType: 'partner', entityId: created.id, metadata: { name: created.name, created: true } });
    return this.get(actor, created.id);
  }

  async update(actor: AuthUser, id: string, raw: PartnerInput): Promise<PartnerView> {
    this.assertManage(actor);
    const input = partnerSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const before = await this.find(tenantId, id);
    await this.checkLinks(tenantId, input, id);
    const { tier: _tier, ...columns } = this.columns(input);
    try {
      await this.db.update(partners).set({ ...columns, updatedAt: new Date() }).where(eq(partners.id, id));
    } catch (err) {
      if (isEmailClash(err)) throw new ConflictException({ message: 'Another partner uses that email.', fieldErrors: { email: 'Already a partner' } });
      throw err;
    }
    // The tier has its own action, with a reason.
    if (input.tier !== before.tier) await this.setTier(actor, id, { tier: input.tier, reason: 'Changed with the partner’s details' });
    await this.audit.record(actor, { action: 'partner.saved', entityType: 'partner', entityId: id, metadata: { name: input.name } });
    return this.get(actor, id);
  }

  private columns(input: ReturnType<typeof partnerSchema.parse>) {
    return {
      name: input.name,
      kind: input.kind,
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
      country: input.country,
      city: input.city,
      address: input.address,
      website: input.website,
      registrationNumber: input.registrationNumber,
      taxId: input.taxId,
      tier: input.tier,
      managerUserId: input.managerUserId ?? null,
      parentPartnerId: input.parentPartnerId ?? null,
      overrideBp: bp(input.overridePercent),
      withholdingBp: input.withholdingPercent === null || input.withholdingPercent === undefined ? null : bp(input.withholdingPercent),
      currency: input.currency,
      notes: input.notes,
    };
  }

  /** The manager is this consultancy's staff; the parent is another of its partners, one level up, never itself. */
  private async checkLinks(tenantId: string, input: ReturnType<typeof partnerSchema.parse>, id: string | null): Promise<void> {
    if (input.managerUserId) {
      const [u] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, input.managerUserId), eq(users.tenantId, tenantId), inArray(users.role, ['manager', 'consultant']), eq(users.isActive, true)))
        .limit(1);
      if (!u) throw new BadRequestException({ message: 'Choose someone on your staff.', fieldErrors: { managerUserId: 'Not on your staff' } });
    }
    if (input.parentPartnerId) {
      if (input.parentPartnerId === id) throw new BadRequestException({ message: 'A partner cannot be its own parent.', fieldErrors: { parentPartnerId: 'Choose another partner' } });
      const parent = await this.find(tenantId, input.parentPartnerId);
      if (parent.parentPartnerId) throw new BadRequestException({ message: 'Sub-agents sit one level under a master partner, not deeper.', fieldErrors: { parentPartnerId: 'That partner is a sub-agent itself' } });
      if (id) {
        const [child] = await this.db.select({ id: partners.id }).from(partners).where(eq(partners.parentPartnerId, id)).limit(1);
        if (child) throw new BadRequestException({ message: 'This partner has sub-agents of its own, so it cannot be one.', fieldErrors: { parentPartnerId: 'It has sub-agents' } });
      }
    } else if (input.overridePercent > 0) {
      throw new BadRequestException({ message: 'An override is paid to a master partner - choose one.', fieldErrors: { overridePercent: 'Only for a sub-agent' } });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Status and tier                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Activating is approval: the papers must be approved and the agreement
   * signed. Suspending stops new students and payouts; terminating also
   * switches its people's logins off.
   */
  async setStatus(actor: AuthUser, id: string, raw: { status: string; reason: string }): Promise<PartnerView> {
    this.assertManage(actor);
    const input = partnerStatusSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const p = await this.find(tenantId, id);
    if (p.status === input.status) return this.get(actor, id);
    if (p.status === 'terminated') throw new BadRequestException('The partnership has ended. Add the partner again to start a new one.');
    if (input.status === 'active') {
      const view = await this.view(tenantId, id, false);
      const missing: string[] = [];
      if (view.kycStatus !== 'approved') missing.push('its registration papers approved');
      if (view.agreementStatus !== 'signed') missing.push('the partner agreement signed');
      if (view.members.filter((m) => m.active).length === 0) missing.push('a login for someone there');
      if (missing.length) throw new BadRequestException(`Before it can be active it needs ${missing.join(', ')}.`);
    }
    const firstApproval = input.status === 'active' && !p.approvedAt;
    await this.db
      .update(partners)
      .set({ status: input.status, ...(firstApproval ? { approvedAt: new Date(), approvedBy: actor.id } : {}), updatedAt: new Date() })
      .where(eq(partners.id, id));
    if (input.status === 'terminated' || input.status === 'active') {
      const ids = (await this.db.select({ id: partnerMembers.userId }).from(partnerMembers).where(eq(partnerMembers.partnerId, id))).map((m) => m.id);
      // Ending the partnership closes its logins; re-activating a suspended one leaves them as they were.
      if (input.status === 'terminated' && ids.length) await this.db.update(users).set({ isActive: false, updatedAt: new Date() }).where(inArray(users.id, ids));
    }
    await this.audit.record(actor, {
      action: firstApproval ? 'partner.approved' : 'partner.status_changed',
      entityType: 'partner',
      entityId: id,
      metadata: { name: p.name, from: p.status, to: input.status, reason: input.reason },
    });
    await this.tellPartner(id, {
      title:
        input.status === 'active'
          ? firstApproval
            ? 'Your partnership is approved - you can register students now'
            : 'Your partnership is active again'
          : input.status === 'suspended'
            ? 'Your partnership has been suspended'
            : input.status === 'terminated'
              ? 'Your partnership has ended'
              : 'Your partnership is being reviewed',
      body: input.reason,
      link: '/partner',
      email: true,
    });
    return this.get(actor, id);
  }

  async setTier(actor: AuthUser, id: string, raw: { tier: string; reason: string }): Promise<PartnerView> {
    this.assertManage(actor);
    const input = partnerTierSchema.parse(raw);
    const p = await this.find(tenantOf(actor), id);
    if (p.tier === input.tier) return this.get(actor, id);
    await this.db.update(partners).set({ tier: input.tier, updatedAt: new Date() }).where(eq(partners.id, id));
    await this.audit.record(actor, { action: 'partner.tier_changed', entityType: 'partner', entityId: id, metadata: { name: p.name, from: p.tier, to: input.tier, reason: input.reason } });
    await this.tellPartner(id, { title: `You are now a ${input.tier[0]!.toUpperCase()}${input.tier.slice(1)} partner`, body: input.reason, link: '/partner' });
    return this.get(actor, id);
  }

  /* ---------------------------------------------------------------- */
  /* Its people                                                        */
  /* ---------------------------------------------------------------- */

  /** Staff (Manage partners), or the partner's own owner or administrator. */
  async addMember(actor: AuthUser, partnerId: string, raw: PartnerMemberInput): Promise<PartnerMemberView[]> {
    const input = partnerMemberSchema.parse(raw);
    const tenantId = tenantOf(actor);
    if (actor.role === 'partner') {
      const ctx = await this.context(actor);
      if (!ctx.canManage || ctx.partner.id !== partnerId) throw new ForbiddenException('Only the owner or an administrator adds people.');
      if (input.role === 'owner') throw new ForbiddenException('Ask the consultancy to change who owns the account.');
    } else this.assertManage(actor);
    const p = await this.find(tenantId, partnerId);
    if (p.status === 'terminated') throw new BadRequestException('The partnership has ended.');
    const [clash] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(sql`lower(${users.email})`, input.email.toLowerCase())))
      .limit(1);
    if (clash) throw new ConflictException({ message: 'Someone here already signs in with that email.', fieldErrors: { email: 'Already in use' } });
    const passwordHash = await hashPassword(input.password);
    const userId = await this.db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({ tenantId, email: input.email, passwordHash, fullName: input.fullName, role: 'partner', phone: input.phone, partnerId })
        .returning({ id: users.id });
      await tx.insert(partnerMembers).values({ tenantId, partnerId, userId: u!.id, role: input.role, createdBy: actor.id });
      return u!.id;
    });
    await this.audit.record(actor, { action: 'partner_user.created', entityType: 'partner', entityId: partnerId, metadata: { partner: p.name, email: input.email, role: input.role, userId } });
    return this.members(partnerId);
  }

  async updateMember(actor: AuthUser, partnerId: string, memberId: string, change: { role?: PartnerMemberRole; active?: boolean }): Promise<PartnerMemberView[]> {
    const tenantId = tenantOf(actor);
    if (actor.role === 'partner') {
      const ctx = await this.context(actor);
      if (!ctx.canManage || ctx.partner.id !== partnerId) throw new ForbiddenException('Only the owner or an administrator changes people.');
      if (change.role === 'owner') throw new ForbiddenException('Ask the consultancy to change who owns the account.');
    } else this.assertManage(actor);
    await this.find(tenantId, partnerId);
    const [m] = await this.db.select().from(partnerMembers).where(and(eq(partnerMembers.id, memberId), eq(partnerMembers.partnerId, partnerId))).limit(1);
    if (!m) throw new NotFoundException('Not one of this partner’s people.');
    if (m.userId === actor.id) throw new BadRequestException('You cannot change your own access.');
    if (actor.role === 'partner' && m.role === 'owner') throw new ForbiddenException('Ask the consultancy to change the owner.');
    if (change.role && change.role !== m.role) {
      if (m.role === 'owner') {
        const [other] = await this.db
          .select({ id: partnerMembers.id })
          .from(partnerMembers)
          .where(and(eq(partnerMembers.partnerId, partnerId), eq(partnerMembers.role, 'owner'), ne(partnerMembers.id, memberId)))
          .limit(1);
        if (!other) throw new BadRequestException('Make someone else the owner first.');
      }
      await this.db.update(partnerMembers).set({ role: change.role }).where(eq(partnerMembers.id, memberId));
    }
    if (change.active !== undefined) await this.db.update(users).set({ isActive: change.active, updatedAt: new Date() }).where(eq(users.id, m.userId));
    await this.audit.record(actor, { action: 'partner_user.updated', entityType: 'partner', entityId: partnerId, metadata: { userId: m.userId, ...change } });
    return this.members(partnerId);
  }

  /* ---------------------------------------------------------------- */
  /* Bank details                                                      */
  /* ---------------------------------------------------------------- */

  /** Sealed at rest; staff who pay partners, or the partner's owner or administrator, set them. */
  async setBank(actor: AuthUser, partnerId: string, raw: PartnerBankInput): Promise<void> {
    const input = partnerBankSchema.parse(raw);
    if (actor.role === 'partner') {
      const ctx = await this.context(actor);
      if (!ctx.canManage || ctx.partner.id !== partnerId) throw new ForbiddenException('Only the owner or an administrator sets the bank account.');
    } else if (!staffCan(actor, 'payout.manage')) throw new ForbiddenException('You need “Pay partners” to change bank details.');
    const p = await this.find(tenantOf(actor), partnerId);
    await this.db.update(partners).set({ bankSealed: seal(JSON.stringify(input)), updatedAt: new Date() }).where(eq(partners.id, partnerId));
    await this.audit.record(actor, { action: 'partner.saved', entityType: 'partner', entityId: partnerId, metadata: { name: p.name, bank: `•••• ${input.iban.slice(-4)}` } });
    if (actor.role === 'partner') {
      // A change of bank account is the classic payment fraud: the people who pay hear of it.
      const holders = await permissionHolders(this.db, p.tenantId, 'payout.manage');
      await this.notifications.pushMany(holders, {
        type: 'partner_update',
        title: `${p.name} changed its bank account`,
        body: `Now ${input.bankName}, •••• ${input.iban.slice(-4)}. Check it with them before the next payout.`,
        link: `/overview/partners/${partnerId}`,
        email: true,
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Registration papers                                               */
  /* ---------------------------------------------------------------- */

  async uploadDocument(actor: AuthUser, partnerId: string, kind: string, file: { buffer: Buffer; originalname: string; size: number }): Promise<PartnerDocumentView[]> {
    if (!(KYC_KINDS as readonly string[]).includes(kind)) throw new BadRequestException('Choose what the paper is.');
    if (actor.role === 'partner') {
      const ctx = await this.context(actor);
      if (!ctx.canManage || ctx.partner.id !== partnerId) throw new ForbiddenException('Only the owner or an administrator uploads registration papers.');
    } else this.assertManage(actor);
    const tenantId = tenantOf(actor);
    const p = await this.find(tenantId, partnerId);
    const valid = await this.documents.accept(actor, file);
    const key = `tenants/${tenantId}/partners/${partnerId}/${randomUUID()}`;
    await this.storage.put(key, valid.buffer, valid.mimeType);
    await this.db.insert(partnerDocuments).values({ tenantId, partnerId, kind, name: valid.fileName, storageKey: key, mime: valid.mimeType, size: valid.buffer.length, uploadedBy: actor.id });
    await this.audit.record(actor, { action: 'partner_document.uploaded', entityType: 'partner', entityId: partnerId, metadata: { partner: p.name, kind, name: valid.fileName } });
    if (actor.role === 'partner') {
      const to = p.managerUserId ? [p.managerUserId] : await permissionHolders(this.db, tenantId, 'partner.manage');
      await this.notifications.pushMany(to, { type: 'partner_update', title: `${p.name} uploaded a registration paper`, body: valid.fileName, link: `/overview/partners/${partnerId}` });
    }
    return (await this.view(tenantId, partnerId, false)).documents;
  }

  async reviewDocument(actor: AuthUser, partnerId: string, documentId: string, raw: { decision: string; note?: string | null }): Promise<PartnerDocumentView[]> {
    this.assertManage(actor);
    const input = kycReviewSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const p = await this.find(tenantId, partnerId);
    const [d] = await this.db.select().from(partnerDocuments).where(and(eq(partnerDocuments.id, documentId), eq(partnerDocuments.partnerId, partnerId))).limit(1);
    if (!d) throw new NotFoundException('Paper not found.');
    await this.db
      .update(partnerDocuments)
      .set({ status: input.decision === 'approve' ? 'approved' : 'rejected', reviewNote: input.note, reviewedBy: actor.id, reviewedAt: new Date() })
      .where(eq(partnerDocuments.id, documentId));
    await this.audit.record(actor, { action: 'partner_document.reviewed', entityType: 'partner', entityId: partnerId, metadata: { partner: p.name, kind: d.kind, name: d.name, decision: input.decision, note: input.note } });
    if (input.decision === 'reject') {
      await this.tellPartner(partnerId, { title: `Please upload your ${d.name} again`, body: input.note ?? null, link: '/partner/profile', email: true });
    }
    return (await this.view(tenantId, partnerId, false)).documents;
  }

  async documentFile(actor: AuthUser, partnerId: string, documentId: string): Promise<{ stream: Readable; name: string; mime: string }> {
    if (actor.role === 'partner') {
      const ctx = await this.context(actor);
      if (ctx.partner.id !== partnerId) throw new NotFoundException('Paper not found.');
    } else this.assertView(actor);
    const [d] = await this.db
      .select()
      .from(partnerDocuments)
      .where(and(eq(partnerDocuments.id, documentId), eq(partnerDocuments.partnerId, partnerId), eq(partnerDocuments.tenantId, tenantOf(actor))))
      .limit(1);
    if (!d) throw new NotFoundException('Paper not found.');
    return { stream: await this.storage.get(d.storageKey), name: d.name, mime: d.mime };
  }

  /* ---------------------------------------------------------------- */
  /* Settings                                                          */
  /* ---------------------------------------------------------------- */

  async settings(tenantId: string): Promise<PartnerSettingsView> {
    let [row] = await this.db.select().from(partnerSettings).where(eq(partnerSettings.tenantId, tenantId)).limit(1);
    if (!row) {
      await this.db.insert(partnerSettings).values({ tenantId }).onConflictDoNothing();
      [row] = await this.db.select().from(partnerSettings).where(eq(partnerSettings.tenantId, tenantId)).limit(1);
    }
    return {
      applicationsOpen: row!.applicationsOpen,
      attributionDays: row!.attributionDays,
      defaultWithholdingPercent: pctOf(row!.defaultWithholdingBp),
      requireSecondApprover: row!.requireSecondApprover,
      minimumPayout: row!.minimumPayout / 100,
      tierThresholds: row!.tierThresholds,
      agreementTemplate: row!.agreementTemplate || DEFAULT_AGREEMENT,
    };
  }

  async readSettings(actor: AuthUser): Promise<PartnerSettingsView> {
    this.assertView(actor);
    return this.settings(tenantOf(actor));
  }

  async saveSettings(actor: AuthUser, raw: PartnerSettingsInput): Promise<PartnerSettingsView> {
    this.assertManage(actor);
    const input = partnerSettingsSchema.parse(raw);
    const tenantId = tenantOf(actor);
    await this.settings(tenantId);
    await this.db
      .update(partnerSettings)
      .set({
        applicationsOpen: input.applicationsOpen,
        attributionDays: input.attributionDays,
        defaultWithholdingBp: bp(input.defaultWithholdingPercent),
        requireSecondApprover: input.requireSecondApprover,
        minimumPayout: Math.round(input.minimumPayout * 100),
        tierThresholds: input.tierThresholds,
        // The default text is not stored: an empty template keeps following it.
        agreementTemplate: input.agreementTemplate === DEFAULT_AGREEMENT ? '' : input.agreementTemplate,
        updatedBy: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(partnerSettings.tenantId, tenantId));
    await this.audit.record(actor, { action: 'partner_settings.changed', entityType: 'settings', entityId: tenantId, metadata: { ...input, agreementTemplate: undefined } });
    return this.settings(tenantId);
  }

  /** Is the public form open on this site? */
  async applicationsOpen(tenantId: string): Promise<{ open: boolean; name: string }> {
    const [s, site] = await Promise.all([this.settings(tenantId), tenantIdentity(this.db, tenantId)]);
    return { open: s.applicationsOpen, name: site.name };
  }

  /* ---------------------------------------------------------------- */
  /* Performance                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Each partner's results over a period: students registered, their
   * applications, offers, visas granted, enrolments (first-year university
   * commission confirmed) and what the partner earned - ranked by enrolments.
   */
  async performance(tenantId: string, from: string, to: string, onlyIds?: string[]): Promise<PartnerPerformanceRow[]> {
    const where = and(eq(partners.tenantId, tenantId), ne(partners.status, 'applied'), onlyIds ? inArray(partners.id, onlyIds.length ? onlyIds : [NIL]) : undefined);
    const list = await this.db.select({ id: partners.id, name: partners.name, tier: partners.tier, status: partners.status }).from(partners).where(where);
    if (!list.length) return [];
    const ids = list.map((p) => p.id);
    const offerAt = STAGES.indexOf('offer_letter');
    const offerStages = STAGES.slice(offerAt);
    const [students, apps, enrolled, earned] = await Promise.all([
      this.db
        .select({ id: clients.partnerId, n: sql<number>`count(*)::int` })
        .from(clients)
        .where(and(inArray(clients.partnerId, ids), sql`coalesce(${clients.partnerAttributedAt}, ${clients.createdAt})::date between ${from} and ${to}`))
        .groupBy(clients.partnerId),
      this.db
        .select({
          id: clients.partnerId,
          applications: sql<number>`count(*)::int`,
          offers: sql<number>`count(*) filter (where ${cases.currentStage} in (${sql.join(offerStages.map((s) => sql`${s}`), sql`, `)}) or ${cases.offerType} is not null)::int`,
          visas: sql<number>`count(*) filter (where ${cases.status} = 'approved')::int`,
        })
        .from(cases)
        .innerJoin(clients, eq(clients.id, cases.clientId))
        .where(and(inArray(clients.partnerId, ids), sql`${cases.createdAt}::date between ${from} and ${to}`))
        .groupBy(clients.partnerId),
      this.db
        .select({ id: clients.partnerId, n: sql<number>`count(distinct ${clients.id})::int` })
        .from(commissions)
        .innerJoin(clients, eq(clients.id, commissions.clientId))
        .where(
          and(
            inArray(clients.partnerId, ids),
            eq(commissions.kind, 'student'),
            eq(commissions.yearNo, 1),
            inArray(commissions.status, ENROLLED),
            sql`${commissions.confirmedAt}::date between ${from} and ${to}`,
          ),
        )
        .groupBy(clients.partnerId),
      this.db
        .select({ id: partnerEarnings.partnerId, currency: partnerEarnings.currency, n: sql<string>`sum(${partnerEarnings.amount})` })
        .from(partnerEarnings)
        .where(and(inArray(partnerEarnings.partnerId, ids), ne(partnerEarnings.status, 'reversed'), sql`${partnerEarnings.earnedOn} between ${from} and ${to}`))
        .groupBy(partnerEarnings.partnerId, partnerEarnings.currency),
    ]);
    const rows = list.map((p) => {
      const s = students.find((x) => x.id === p.id)?.n ?? 0;
      const a = apps.find((x) => x.id === p.id);
      const e = enrolled.find((x) => x.id === p.id)?.n ?? 0;
      return {
        partnerId: p.id,
        name: p.name,
        tier: p.tier as PartnerTier,
        status: p.status as PartnerStatus,
        students: s,
        applications: a?.applications ?? 0,
        offers: a?.offers ?? 0,
        visas: a?.visas ?? 0,
        enrolled: e,
        conversionPercent: s ? Math.round((e / s) * 1000) / 10 : 0,
        earned: earned.filter((x) => x.id === p.id && Number(x.n) !== 0).map((x) => ({ currency: x.currency as Currency, amount: Number(x.n) })),
        rank: 0,
      };
    });
    rows.sort((a, b) => b.enrolled - a.enrolled || b.offers - a.offers || b.students - a.students || a.name.localeCompare(b.name));
    let rank = 0;
    let last: string | null = null;
    rows.forEach((r, i) => {
      const key = `${r.enrolled}:${r.offers}:${r.students}`;
      if (key !== last) rank = i + 1;
      last = key;
      r.rank = rank;
    });
    return rows;
  }

  async leaderboard(actor: AuthUser, period: { from?: string; to?: string }): Promise<{ from: string; to: string; rows: (PartnerPerformanceRow & { suggestedTier: PartnerTier })[] }> {
    this.assertView(actor);
    const tenantId = tenantOf(actor);
    const to = period.to && /^\d{4}-\d{2}-\d{2}$/.test(period.to) ? period.to : today();
    const from = period.from && /^\d{4}-\d{2}-\d{2}$/.test(period.from) ? period.from : yearBefore(to);
    const [rows, settings, yearRows] = await Promise.all([this.performance(tenantId, from, to), this.settings(tenantId), this.performance(tenantId, yearBefore(today()), today())]);
    return {
      from,
      to,
      rows: rows.map((r) => ({ ...r, suggestedTier: tierFor(yearRows.find((y) => y.partnerId === r.partnerId)?.enrolled ?? 0, settings.tierThresholds) })),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  /** In-app (and optionally email) to the partner's owners and administrators. */
  async tellPartner(partnerId: string, entry: { title: string; body?: string | null; link?: string | null; email?: boolean; attachments?: MailAttachment[] }, everyone = false): Promise<void> {
    const rows = await this.db
      .select({ id: partnerMembers.userId })
      .from(partnerMembers)
      .innerJoin(users, eq(users.id, partnerMembers.userId))
      .where(and(eq(partnerMembers.partnerId, partnerId), eq(users.isActive, true), everyone ? undefined : inArray(partnerMembers.role, ['owner', 'admin'])));
    await this.notifications.pushMany(
      rows.map((r) => r.id),
      { type: 'partner_update', ...entry },
    );
  }

  /** The staff who hear about a partner: its manager, or everyone who manages partners. */
  async staffFor(p: Pick<PartnerRow, 'tenantId' | 'managerUserId'>): Promise<string[]> {
    if (p.managerUserId) {
      const [u] = await this.db.select({ id: users.id }).from(users).where(and(eq(users.id, p.managerUserId), eq(users.isActive, true))).limit(1);
      if (u) return [u.id];
    }
    return permissionHolders(this.db, p.tenantId, 'partner.manage');
  }

  /** The consultant who should look after a partner's new student: its manager, when they are a consultant. */
  async consultantFor(p: Pick<PartnerRow, 'managerUserId'>): Promise<string | null> {
    if (!p.managerUserId) return null;
    const [c] = await this.db.select({ id: consultants.id }).from(consultants).where(eq(consultants.userId, p.managerUserId)).limit(1);
    return c?.id ?? null;
  }

  async baseCurrency(tenantId: string): Promise<Currency> {
    const r = await this.db.execute<{ base_currency: string }>(sql`select base_currency from finance_settings where tenant_id = ${tenantId} limit 1`);
    const rows = (r as unknown as { rows?: { base_currency: string }[] }).rows ?? (r as unknown as { base_currency: string }[]);
    return (rows[0]?.base_currency ?? 'PKR') as Currency;
  }

  /** Partner ids this partner sees students of: itself and its sub-agents. */
  async family(partnerId: string): Promise<string[]> {
    const subs = await this.db.select({ id: partners.id }).from(partners).where(eq(partners.parentPartnerId, partnerId));
    return [partnerId, ...subs.map((s) => s.id)];
  }
}

function isEmailClash(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string; message?: string; cause?: { code?: string; constraint?: string } };
  const code = e.code ?? e.cause?.code;
  const constraint = e.constraint ?? e.cause?.constraint ?? e.message ?? '';
  return code === '23505' && String(constraint).includes('partners_tenant_email_key');
}

function yearBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
