import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Readable } from 'node:stream';
import {
  STAGE_DEFINITIONS,
  assignStudentSchema,
  passportKey,
  phoneKey,
  registerStudentSchema,
  resolveConflictSchema,
  type AttributionConflictView,
  type AttributionMatch,
  type AuthUser,
  type ConflictStatus,
  type PartnerStudentView,
  type RegisterStudentInput,
  type Stage,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { attributionConflicts, cases, clients, consultants, docFolders, documents, partners, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CasesService } from '../cases/cases.service';
import { DocumentsService } from '../documents/documents.service';
import { EntitlementsService } from '../tenancy/entitlements.service';
import { STORAGE, type StorageDriver } from '../storage/storage.driver';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { staffCan } from '../auth/permissions';
import { iso, isoOrNull } from '../common/db-helpers';
import { qualified } from '../documents/drive-sql';
import { permissionHolders } from '../common/permission-holders';
import { PartnersService, type PartnerContext } from './partners.service';

/** The student fields a partner sees: enough to work the application, not the consultancy's notes. */
export interface PartnerStudentDetail extends PartnerStudentView {
  city: string | null;
  nationality: string | null;
  intendedLevel: string | null;
  intendedField: string | null;
  englishTest: string | null;
  englishScore: string | null;
  documentList: { id: string; name: string; type: string; status: string; uploadedAt: string; byYou: boolean }[];
}

/**
 * Who a student belongs to. A partner registers a student in its portal; if
 * nobody here has them (same email, phone or passport), they are the
 * partner's. If somebody does - the consultancy itself or another partner -
 * the first to register keeps them, and the claim goes to a queue where
 * staff decide, seeing whether the first registration has lapsed (older than
 * the attribution window, with no live application).
 */
@Injectable()
export class AttributionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly cases: CasesService,
    private readonly documents: DocumentsService,
    private readonly entitlements: EntitlementsService,
    private readonly partners: PartnersService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Registering                                                       */
  /* ---------------------------------------------------------------- */

  async register(actor: AuthUser, raw: RegisterStudentInput): Promise<{ status: 'registered'; clientId: string } | { status: 'conflict'; conflictId: string } | { status: 'yours'; clientId: string }> {
    const ctx = await this.partners.context(actor);
    this.partners.assertActive(ctx);
    const input = registerStudentSchema.parse(raw);
    const tenantId = tenantOf(actor);

    const matches = await this.findSame(tenantId, input);
    if (matches.length) {
      const own = matches.find((m) => m.partnerId === ctx.partner.id);
      if (own) return { status: 'yours', clientId: own.id };
      const first = matches[0]!;
      const matchedOn = whatMatched(first, input);
      const [existing] = await this.db
        .select({ id: attributionConflicts.id })
        .from(attributionConflicts)
        .where(and(eq(attributionConflicts.clientId, first.id), eq(attributionConflicts.claimantPartnerId, ctx.partner.id), eq(attributionConflicts.status, 'open')))
        .limit(1);
      if (existing) return { status: 'conflict', conflictId: existing.id };
      const [c] = await this.db
        .insert(attributionConflicts)
        .values({
          tenantId,
          clientId: first.id,
          currentPartnerId: first.partnerId,
          claimantPartnerId: ctx.partner.id,
          claimedBy: actor.id,
          matchedOn,
          submitted: { fullName: input.fullName, email: input.email, phone: input.phone, passportNumber: input.passportNumber, notes: input.notes },
        })
        .returning();
      await this.audit.record(actor, { action: 'attribution.conflict', entityType: 'client', entityId: first.id, clientId: first.id, metadata: { claimant: ctx.partner.name, matchedOn, current: first.partnerId } });
      const staff = await permissionHolders(this.db, tenantId, 'partner.manage');
      await this.notifications.pushMany(staff, {
        type: 'attribution_conflict',
        title: `${ctx.partner.name} registered a student you already have`,
        body: `${input.fullName} - same ${matchedOn.join(', ')}. Decide who they belong to.`,
        link: '/overview/partners/conflicts',
      });
      return { status: 'conflict', conflictId: c!.id };
    }

    await this.entitlements.assertCanAddClient(tenantId);
    const consultantId = await this.partners.consultantFor(ctx.partner);
    const [created] = await this.db
      .insert(clients)
      .values({
        tenantId,
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        city: input.city,
        nationality: input.nationality,
        passportNumber: input.passportNumber,
        dateOfBirth: input.dateOfBirth ?? null,
        intendedLevel: input.intendedLevel,
        intendedField: input.intendedField,
        englishTest: input.englishTest,
        englishScore: input.englishScore,
        preferredCountries: input.firstApplication ? [input.firstApplication.targetCountry] : [],
        leadSource: 'referral',
        notes: [`Registered by partner ${ctx.partner.name} (${ctx.partner.number}).`, input.notes].filter(Boolean).join('\n\n'),
        assignedConsultantId: consultantId,
        partnerId: ctx.partner.id,
        partnerAttributedAt: new Date(),
        partnerRegisteredBy: actor.id,
        createdBy: actor.id,
      })
      .returning();
    await this.audit.record(actor, { action: 'client.created', entityType: 'client', entityId: created!.id, clientId: created!.id, metadata: { fullName: created!.fullName, partner: ctx.partner.name } });
    if (input.firstApplication) {
      await this.cases.createForClient(actor, {
        clientId: created!.id,
        consultantId,
        targetCountry: input.firstApplication.targetCountry,
        targetUniversity: input.firstApplication.targetUniversity,
        targetProgram: input.firstApplication.targetProgram,
        studyLevel: input.intendedLevel,
        intake: input.firstApplication.intake,
      });
    }
    const staff = await this.partners.staffFor(ctx.partner);
    const consultantUser = consultantId ? (await this.db.select({ id: consultants.userId }).from(consultants).where(eq(consultants.id, consultantId)).limit(1))[0]?.id : null;
    await this.notifications.pushMany([...new Set([...staff, ...(consultantUser ? [consultantUser] : [])])], {
      type: 'client_assigned',
      title: `New student from ${ctx.partner.name}: ${created!.fullName}`,
      body: input.firstApplication ? `Wants ${input.firstApplication.targetCountry}${input.firstApplication.intake ? `, ${input.firstApplication.intake}` : ''}.` : 'No application yet.',
      link: `/overview/clients/${created!.id}`,
    });
    return { status: 'registered', clientId: created!.id };
  }

  /** The same person already on the books: email, phone (last ten digits) or passport. Oldest first. */
  private async findSame(tenantId: string, input: { email: string; phone: string; passportNumber?: string | null }) {
    const phone = phoneKey(input.phone);
    const passport = passportKey(input.passportNumber);
    const conds: SQL[] = [sql`lower(${clients.email}) = ${input.email.toLowerCase()}`];
    if (phone) conds.push(sql`right(regexp_replace(${clients.phone}, '\\D', '', 'g'), 10) = ${phone}`);
    if (passport) conds.push(sql`upper(regexp_replace(coalesce(${clients.passportNumber}, ''), '[^A-Za-z0-9]', '', 'g')) = ${passport}`);
    return this.db
      .select({ id: clients.id, email: clients.email, phone: clients.phone, passportNumber: clients.passportNumber, partnerId: clients.partnerId, attributedAt: clients.partnerAttributedAt, createdAt: clients.createdAt })
      .from(clients)
      .where(and(eq(clients.tenantId, tenantId), or(...conds)))
      .orderBy(asc(sql`coalesce(${clients.partnerAttributedAt}, ${clients.createdAt})`))
      .limit(5);
  }

  /* ---------------------------------------------------------------- */
  /* The conflict queue                                                */
  /* ---------------------------------------------------------------- */

  async conflicts(actor: AuthUser, status: string = 'open'): Promise<AttributionConflictView[]> {
    let claimant: string | null = null;
    if (actor.role === 'partner') claimant = (await this.partners.context(actor)).partner.id;
    else this.partners.assertView(actor);
    const tenantId = tenantOf(actor);
    const current = alias(partners, 'current_partner');
    const claimantP = alias(partners, 'claimant_partner');
    const claimer = alias(users, 'claimer');
    const decider = alias(users, 'decider');
    const rows = await this.db
      .select({
        c: attributionConflicts,
        clientName: clients.fullName,
        registeredAt: sql<Date>`coalesce(${clients.partnerAttributedAt}, ${clients.createdAt})`,
        currentName: current.name,
        claimantName: claimantP.name,
        claimedByName: claimer.fullName,
        decidedByName: decider.fullName,
        liveApps: sql<number>`(select count(*)::int from cases k where k.client_id = ${qualified('clients', 'id')} and k.status in ('active', 'on_hold'))`,
      })
      .from(attributionConflicts)
      .innerJoin(clients, eq(clients.id, attributionConflicts.clientId))
      .leftJoin(current, eq(current.id, attributionConflicts.currentPartnerId))
      .innerJoin(claimantP, eq(claimantP.id, attributionConflicts.claimantPartnerId))
      .leftJoin(claimer, eq(claimer.id, attributionConflicts.claimedBy))
      .leftJoin(decider, eq(decider.id, attributionConflicts.decidedBy))
      .where(
        and(
          eq(attributionConflicts.tenantId, tenantId),
          status === 'all' ? undefined : status === 'decided' ? ne(attributionConflicts.status, 'open') : eq(attributionConflicts.status, status),
          claimant ? eq(attributionConflicts.claimantPartnerId, claimant) : undefined,
        ),
      )
      .orderBy(desc(attributionConflicts.createdAt))
      .limit(200);
    const windowDays = (await this.partners.settings(tenantId)).attributionDays;
    return rows.map((r) => {
      const registeredAt = new Date(r.registeredAt);
      const lapsed = r.liveApps === 0 && Date.now() - registeredAt.getTime() > windowDays * 86_400_000;
      return {
        id: r.c.id,
        clientId: r.c.clientId,
        // A partner sees only what it entered, never the other side's record.
        clientName: claimant ? r.c.submitted.fullName : r.clientName,
        currentPartnerId: claimant ? null : r.c.currentPartnerId,
        currentPartnerName: claimant ? null : r.currentName,
        registeredAt: claimant ? iso(r.c.createdAt) : registeredAt.toISOString(),
        claimantPartnerId: r.c.claimantPartnerId,
        claimantPartnerName: r.claimantName,
        claimedByName: r.claimedByName,
        matchedOn: r.c.matchedOn as AttributionMatch[],
        submitted: r.c.submitted,
        lapsed: claimant ? false : lapsed,
        status: r.c.status as ConflictStatus,
        decidedByName: r.decidedByName,
        decidedAt: isoOrNull(r.c.decidedAt),
        decisionNote: r.c.decisionNote,
        createdAt: iso(r.c.createdAt),
      };
    });
  }

  async resolve(actor: AuthUser, id: string, raw: { decision: string; note: string }): Promise<AttributionConflictView[]> {
    this.partners.assertManage(actor);
    const input = resolveConflictSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const [c] = await this.db.select().from(attributionConflicts).where(and(eq(attributionConflicts.id, id), eq(attributionConflicts.tenantId, tenantId))).limit(1);
    if (!c) throw new NotFoundException('Not found.');
    if (c.status !== 'open') throw new BadRequestException('It has been decided already.');
    const [client] = await this.db.select().from(clients).where(eq(clients.id, c.clientId)).limit(1);
    const claimant = await this.partners.find(tenantId, c.claimantPartnerId);
    await this.db.transaction(async (tx) => {
      await tx
        .update(attributionConflicts)
        .set({ status: input.decision === 'transfer' ? 'transferred' : 'kept', decidedBy: actor.id, decidedAt: new Date(), decisionNote: input.note })
        .where(eq(attributionConflicts.id, id));
      if (input.decision === 'transfer') {
        await tx.update(clients).set({ partnerId: c.claimantPartnerId, partnerAttributedAt: new Date(), partnerRegisteredBy: c.claimedBy, updatedAt: new Date() }).where(eq(clients.id, c.clientId));
        // Other claims on the same student are settled by this one.
        await tx
          .update(attributionConflicts)
          .set({ status: 'kept', decidedBy: actor.id, decidedAt: new Date(), decisionNote: `Moved to ${claimant.name}: ${input.note}` })
          .where(and(eq(attributionConflicts.clientId, c.clientId), eq(attributionConflicts.status, 'open'), ne(attributionConflicts.id, id)));
      }
    });
    await this.audit.record(actor, {
      action: input.decision === 'transfer' ? 'attribution.changed' : 'attribution.resolved',
      entityType: 'client',
      entityId: c.clientId,
      clientId: c.clientId,
      metadata: { student: client?.fullName, from: c.currentPartnerId, to: input.decision === 'transfer' ? c.claimantPartnerId : c.currentPartnerId, claimant: claimant.name, note: input.note },
    });
    await this.partners.tellPartner(
      c.claimantPartnerId,
      {
        title: input.decision === 'transfer' ? `${c.submitted.fullName} is now your student` : `${c.submitted.fullName} stays with whoever registered them first`,
        body: input.note,
        link: input.decision === 'transfer' ? `/partner/students/${c.clientId}` : '/partner/students',
      },
      true,
    );
    if (input.decision === 'transfer' && c.currentPartnerId) {
      await this.partners.tellPartner(c.currentPartnerId, { title: `${client?.fullName ?? 'A student'} was moved to another partner`, body: input.note, link: '/partner/students' });
    }
    return this.conflicts(actor, 'open');
  }

  /** Staff credit a student to a partner (or take them back to the consultancy). */
  async assign(actor: AuthUser, clientId: string, raw: { partnerId: string | null; reason: string }): Promise<{ partnerId: string | null; partnerName: string | null }> {
    this.partners.assertManage(actor);
    const input = assignStudentSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const [client] = await this.db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId))).limit(1);
    if (!client) throw new NotFoundException('Student not found.');
    let name: string | null = null;
    if (input.partnerId) {
      const p = await this.partners.find(tenantId, input.partnerId);
      if (p.status === 'applied' || p.status === 'terminated') throw new BadRequestException('Students go to partners that are onboarding, active or suspended.');
      name = p.name;
    }
    if (client.partnerId === input.partnerId) return { partnerId: input.partnerId, partnerName: name };
    await this.db
      .update(clients)
      .set({ partnerId: input.partnerId, partnerAttributedAt: input.partnerId ? new Date() : null, partnerRegisteredBy: null, updatedAt: new Date() })
      .where(eq(clients.id, clientId));
    await this.audit.record(actor, { action: 'attribution.changed', entityType: 'client', entityId: clientId, clientId, metadata: { student: client.fullName, from: client.partnerId, to: input.partnerId, reason: input.reason } });
    if (input.partnerId) await this.partners.tellPartner(input.partnerId, { title: `${client.fullName} is now your student`, body: input.reason, link: `/partner/students/${clientId}` }, true);
    if (client.partnerId) await this.partners.tellPartner(client.partnerId, { title: `${client.fullName} is no longer your student`, body: input.reason, link: '/partner/students' });
    return { partnerId: input.partnerId, partnerName: name };
  }

  /** For the student's page: who brought them. */
  async partnerOf(actor: AuthUser, clientId: string): Promise<{ partnerId: string | null; partnerName: string | null; attributedAt: string | null; canChange: boolean }> {
    if (actor.role !== 'manager' && actor.role !== 'consultant') throw new ForbiddenException();
    const [r] = await this.db
      .select({ partnerId: clients.partnerId, partnerName: partners.name, attributedAt: clients.partnerAttributedAt })
      .from(clients)
      .leftJoin(partners, eq(partners.id, clients.partnerId))
      .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantOf(actor))))
      .limit(1);
    if (!r) throw new NotFoundException('Student not found.');
    return { partnerId: r.partnerId, partnerName: r.partnerName, attributedAt: isoOrNull(r.attributedAt), canChange: staffCan(actor, 'partner.manage') };
  }

  /* ---------------------------------------------------------------- */
  /* A partner's students                                              */
  /* ---------------------------------------------------------------- */

  /** A partner's own students, and its sub-agents' (marked as theirs). */
  async students(actor: AuthUser, opts: { partnerId?: string; q?: string }): Promise<PartnerStudentView[]> {
    let ids: string[];
    let own: string;
    if (actor.role === 'partner') {
      const ctx = await this.partners.context(actor);
      own = ctx.partner.id;
      ids = await this.partners.family(own);
    } else {
      this.partners.assertView(actor);
      if (!opts.partnerId) throw new BadRequestException('Which partner?');
      await this.partners.find(tenantOf(actor), opts.partnerId);
      own = opts.partnerId;
      ids = await this.partners.family(own);
    }
    return this.studentViews(tenantOf(actor), ids, own, opts.q);
  }

  private async studentViews(tenantId: string, partnerIds: string[], own: string, q?: string, onlyClient?: string): Promise<PartnerStudentView[]> {
    const registrar = alias(users, 'registrar');
    const consultantUser = alias(users, 'consultant_user');
    const rows = await this.db
      .select({
        c: clients,
        partnerName: partners.name,
        registeredByName: registrar.fullName,
        consultantName: consultantUser.fullName,
        docs: sql<number>`(select count(*)::int from documents d where d.client_id = ${qualified('clients', 'id')} and d.trashed_at is null and d.deleted_at is null and d.superseded_by is null)`,
      })
      .from(clients)
      .innerJoin(partners, eq(partners.id, clients.partnerId))
      .leftJoin(registrar, eq(registrar.id, clients.partnerRegisteredBy))
      .leftJoin(consultants, eq(consultants.id, clients.assignedConsultantId))
      .leftJoin(consultantUser, eq(consultantUser.id, consultants.userId))
      .where(
        and(
          eq(clients.tenantId, tenantId),
          inArray(clients.partnerId, partnerIds),
          eq(clients.archived, false),
          onlyClient ? eq(clients.id, onlyClient) : undefined,
          q ? or(sql`${clients.fullName} ilike ${`%${q}%`}`, sql`${clients.email} ilike ${`%${q}%`}`, sql`${clients.phone} ilike ${`%${q}%`}`) : undefined,
        ),
      )
      .orderBy(desc(sql`coalesce(${clients.partnerAttributedAt}, ${clients.createdAt})`))
      .limit(500);
    const apps = rows.length
      ? await this.db
          .select()
          .from(cases)
          .where(inArray(cases.clientId, rows.map((r) => r.c.id)))
          .orderBy(desc(cases.createdAt))
      : [];
    return rows.map((r) => ({
      clientId: r.c.id,
      fullName: r.c.fullName,
      email: r.c.email,
      phone: r.c.phone,
      attributedAt: isoOrNull(r.c.partnerAttributedAt),
      registeredByName: r.registeredByName,
      consultantName: r.consultantName,
      applications: apps
        .filter((a) => a.clientId === r.c.id)
        .map((a) => ({
          id: a.id,
          reference: a.reference,
          country: a.targetCountry,
          university: a.targetUniversity,
          program: a.targetProgram,
          intake: a.intake,
          stage: a.currentStageKey ?? a.currentStage,
          stageLabel: a.currentStageName ?? STAGE_DEFINITIONS[a.currentStage as Stage]?.label ?? a.currentStage,
          status: a.status,
        })),
      documents: r.docs,
      viaPartnerName: r.c.partnerId === own ? null : r.partnerName,
      createdAt: iso(r.c.createdAt),
    }));
  }

  async student(actor: AuthUser, clientId: string): Promise<PartnerStudentDetail> {
    const ctx = await this.partners.context(actor);
    const ids = await this.partners.family(ctx.partner.id);
    const tenantId = tenantOf(actor);
    const [view] = await this.studentViews(tenantId, ids, ctx.partner.id, undefined, clientId);
    if (!view) throw new NotFoundException('Student not found.');
    const [c] = await this.db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
    const memberIds = (await this.partners.members(ctx.partner.id)).map((m) => m.userId);
    const docs = await this.visibleDocuments(clientId);
    return {
      ...view,
      city: c!.city,
      nationality: c!.nationality,
      intendedLevel: c!.intendedLevel,
      intendedField: c!.intendedField,
      englishTest: c!.englishTest,
      englishScore: c!.englishScore,
      documentList: docs.map((d) => ({ id: d.id, name: d.fileName, type: d.typeKey, status: d.status, uploadedAt: iso(d.uploadedAt), byYou: memberIds.includes(d.uploadedBy) })),
    };
  }

  /** The student's documents a partner may see: current versions, not trashed, not in a restricted folder. */
  private visibleDocuments(clientId: string) {
    return this.db
      .select({ id: documents.id, fileName: documents.fileName, typeKey: documents.typeKey, status: documents.status, uploadedAt: documents.uploadedAt, uploadedBy: documents.uploadedBy, fileKey: documents.fileKey, mimeType: documents.mimeType })
      .from(documents)
      .leftJoin(docFolders, eq(docFolders.id, documents.folderId))
      .where(
        and(
          eq(documents.clientId, clientId),
          isNull(documents.trashedAt),
          isNull(documents.deletedAt),
          isNull(documents.supersededBy),
          sql`coalesce(${docFolders.restricted}, false) = false`,
        ),
      )
      .orderBy(desc(documents.uploadedAt));
  }

  async upload(actor: AuthUser, clientId: string, typeKey: string | null, file: { buffer: Buffer; originalname: string; size: number }): Promise<PartnerStudentDetail> {
    const ctx = await this.partners.context(actor);
    this.partners.assertActive(ctx);
    await this.assertMine(ctx, clientId, true);
    const valid = await this.documents.accept(actor, file);
    await this.documents.store(actor, { clientId, caseId: null, typeKey }, valid);
    return this.student(actor, clientId);
  }

  async download(actor: AuthUser, clientId: string, documentId: string): Promise<{ stream: Readable; name: string; mime: string }> {
    const ctx = await this.partners.context(actor);
    await this.assertMine(ctx, clientId, false);
    const doc = (await this.visibleDocuments(clientId)).find((d) => d.id === documentId);
    if (!doc) throw new NotFoundException('Document not found.');
    await this.audit.recordView(actor, { action: 'document.downloaded', entityType: 'document', entityId: documentId, clientId, metadata: { fileName: doc.fileName, partner: ctx.partner.name } });
    return { stream: await this.storage.get(doc.fileKey), name: doc.fileName, mime: doc.mimeType };
  }

  /** Its own student; a sub-agent's only to read. */
  private async assertMine(ctx: PartnerContext, clientId: string, write: boolean): Promise<void> {
    const ids = write ? [ctx.partner.id] : await this.partners.family(ctx.partner.id);
    const [c] = await this.db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId), inArray(clients.partnerId, ids))).limit(1);
    if (!c) throw new NotFoundException('Student not found.');
  }
}

function whatMatched(c: { email: string; phone: string; passportNumber: string | null }, input: { email: string; phone: string; passportNumber?: string | null }): AttributionMatch[] {
  const out: AttributionMatch[] = [];
  if (c.email.toLowerCase() === input.email.toLowerCase()) out.push('email');
  const p = phoneKey(input.phone);
  if (p && phoneKey(c.phone) === p) out.push('phone');
  const pp = passportKey(input.passportNumber);
  if (pp && passportKey(c.passportNumber) === pp) out.push('passport');
  return out.length ? out : ['email'];
}

