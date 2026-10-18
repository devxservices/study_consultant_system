import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import {
  localIsoDateIn,
  STAGES,
  STAGE_DEFINITIONS,
  type Stage,
  kycStatus,
  partnerMessageSchema,
  type AuthUser,
  type KycKind,
  type PartnerAgreementStatus,
  type PartnerDashboard,
  type PartnerKind,
  type PartnerMessageView,
  type PartnerStatus,
  type PartnerTier,
  type Currency,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { announcements, caseStageEvents, cases, clients, docFolders, documents, partnerAgreements, partnerDocuments, partnerMessages, users, workflowStages } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { STORAGE, type StorageDriver } from '../storage/storage.driver';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { iso, isoOrNull, today } from '../common/db-helpers';
import { PartnersService } from './partners.service';
import { PartnerEarningsService } from './earnings.service';

const OFFER_ON = STAGES.slice(STAGES.indexOf('offer_letter'));

/**
 * The partner's own portal: its dashboard, its conversation with the
 * consultancy, the marketing library the consultancy shares with partners,
 * and announcements addressed to partners.
 */
@Injectable()
export class PartnerPortalService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly partners: PartnersService,
    private readonly earnings: PartnerEarningsService,
  ) {}

  async dashboard(actor: AuthUser): Promise<PartnerDashboard> {
    const ctx = await this.partners.context(actor);
    const p = ctx.partner;
    const tenantId = tenantOf(actor);
    const family = await this.partners.family(p.id);
    const yearStart = `${today().slice(0, 4)}-01-01`;
    const yearAgo = localIsoDateIn(-365);
    const [[counts], [enrolled], [lastYear], docs, [agreement], recent, notices, [unread], settings] = await Promise.all([
      this.db
        .select({
          students: sql<number>`count(distinct ${clients.id})::int`,
          active: sql<number>`count(${cases.id}) filter (where ${cases.status} in ('active', 'on_hold'))::int`,
          offers: sql<number>`count(${cases.id}) filter (where ${cases.currentStage} in (${sql.join(OFFER_ON.map((s) => sql`${s}`), sql`, `)}) or ${cases.offerType} is not null)::int`,
          visas: sql<number>`count(${cases.id}) filter (where ${cases.status} = 'approved')::int`,
        })
        .from(clients)
        .leftJoin(cases, eq(cases.clientId, clients.id))
        .where(and(inArray(clients.partnerId, family), eq(clients.archived, false))),
      this.enrolledSince(family, yearStart),
      this.enrolledSince([p.id], yearAgo),
      this.db.select({ kind: partnerDocuments.kind, status: partnerDocuments.status }).from(partnerDocuments).where(eq(partnerDocuments.partnerId, p.id)),
      this.db
        .select({ id: partnerAgreements.id, status: partnerAgreements.status, title: partnerAgreements.title })
        .from(partnerAgreements)
        .where(and(eq(partnerAgreements.partnerId, p.id), inArray(partnerAgreements.status, ['sent', 'signed'])))
        .orderBy(desc(partnerAgreements.version))
        .limit(1),
      this.db
        .select({ clientId: clients.id, clientName: clients.fullName, stage: caseStageEvents.stage, stageName: workflowStages.name, at: caseStageEvents.enteredAt, ref: cases.reference })
        .from(caseStageEvents)
        .innerJoin(cases, eq(cases.id, caseStageEvents.caseId))
        .innerJoin(clients, eq(clients.id, cases.clientId))
        .leftJoin(workflowStages, and(eq(workflowStages.versionId, caseStageEvents.workflowVersionId), eq(workflowStages.key, caseStageEvents.stageKey)))
        .where(inArray(clients.partnerId, family))
        .orderBy(desc(caseStageEvents.enteredAt))
        .limit(8),
      this.announcementsFor(tenantId),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(partnerMessages)
        .where(and(eq(partnerMessages.partnerId, p.id), eq(partnerMessages.fromPartner, false), isNull(partnerMessages.readAt))),
      this.partners.settings(tenantId),
    ]);
    const tiers: PartnerTier[] = ['standard', 'silver', 'gold', 'platinum'];
    const next = tiers[tiers.indexOf(p.tier as PartnerTier) + 1] as PartnerTier | undefined;
    const needed = next && next !== 'standard' ? settings.tierThresholds[next] : null;
    return {
      partner: { id: p.id, name: p.name, status: p.status as PartnerStatus, tier: p.tier as PartnerTier, kind: p.kind as PartnerKind, currency: p.currency as Currency },
      me: { role: ctx.role, canManage: ctx.canManage },
      counts: { students: counts?.students ?? 0, activeApplications: counts?.active ?? 0, offers: counts?.offers ?? 0, visas: counts?.visas ?? 0, enrolledThisYear: enrolled?.n ?? 0 },
      earnings: ctx.canManage ? await this.earnings.totals(p.id) : [],
      expected: ctx.canManage ? await this.earnings.expected(tenantId, p) : [],
      nextTier: next && needed ? { tier: next, needed, enrolledLast12Months: lastYear?.n ?? 0 } : null,
      agreement: agreement ? { id: agreement.id, status: agreement.status as PartnerAgreementStatus, title: agreement.title } : null,
      kyc: kycStatus(docs.map((d) => ({ kind: d.kind as KycKind, status: d.status as 'pending' | 'approved' | 'rejected' }))),
      recent: recent.map((r) => ({ clientId: r.clientId, clientName: r.clientName, text: `${r.ref}: reached ${r.stageName ?? STAGE_DEFINITIONS[r.stage as Stage]?.label ?? r.stage}`, at: iso(r.at) })),
      announcements: notices,
      unreadMessages: unread?.n ?? 0,
    };
  }

  private async enrolledSince(partnerIds: string[], from: string) {
    const r = await this.db.execute<{ n: number }>(sql`
      select count(distinct c.client_id)::int as n
      from commissions c join clients k on k.id = c.client_id
      where k.partner_id in (${sql.join(partnerIds.map((id) => sql`${id}::uuid`), sql`, `)})
        and c.kind = 'student' and c.year_no = 1
        and c.status in ('confirmed', 'claimed', 'disputed', 'written_off', 'clawed_back')
        and c.confirmed_at::date >= ${from}`);
    return ((r as unknown as { rows?: { n: number }[] }).rows ?? (r as unknown as { n: number }[])) as { n: number }[];
  }

  async announcementsFor(tenantId: string): Promise<PartnerDashboard['announcements']> {
    const rows = await this.db
      .select()
      .from(announcements)
      .where(and(eq(announcements.tenantId, tenantId), eq(announcements.audience, 'partners'), or(isNull(announcements.expiresOn), gte(announcements.expiresOn, today()))))
      .orderBy(desc(announcements.pinned), desc(announcements.createdAt))
      .limit(10);
    return rows.map((a) => ({ id: a.id, title: a.title, body: a.body, pinned: a.pinned, createdAt: iso(a.createdAt) }));
  }

  /* ---------------------------------------------------------------- */
  /* Messages                                                          */
  /* ---------------------------------------------------------------- */

  /** The partner's thread, from either side. Reading it marks the other side's messages read. */
  async messages(actor: AuthUser, partnerId?: string): Promise<PartnerMessageView[]> {
    let id: string;
    let fromPartner: boolean;
    if (actor.role === 'partner') {
      id = (await this.partners.context(actor)).partner.id;
      fromPartner = true;
    } else {
      this.partners.assertView(actor);
      if (!partnerId) throw new NotFoundException('Partner not found.');
      await this.partners.find(tenantOf(actor), partnerId);
      id = partnerId;
      fromPartner = false;
    }
    await this.db
      .update(partnerMessages)
      .set({ readAt: new Date() })
      .where(and(eq(partnerMessages.partnerId, id), eq(partnerMessages.fromPartner, !fromPartner), isNull(partnerMessages.readAt)));
    const rows = await this.db
      .select({ m: partnerMessages, authorName: users.fullName, clientName: clients.fullName })
      .from(partnerMessages)
      .leftJoin(users, eq(users.id, partnerMessages.authorId))
      .leftJoin(clients, eq(clients.id, partnerMessages.clientId))
      .where(eq(partnerMessages.partnerId, id))
      .orderBy(asc(partnerMessages.createdAt))
      .limit(500);
    return rows.map((r) => ({
      id: r.m.id,
      fromPartner: r.m.fromPartner,
      authorName: r.authorName ?? 'Someone',
      body: r.m.body,
      clientId: r.m.clientId,
      clientName: r.clientName,
      readAt: isoOrNull(r.m.readAt),
      createdAt: iso(r.m.createdAt),
    }));
  }

  async send(actor: AuthUser, raw: { body: string; clientId?: string | null }, partnerId?: string): Promise<PartnerMessageView[]> {
    const input = partnerMessageSchema.parse(raw);
    const tenantId = tenantOf(actor);
    let p;
    let fromPartner: boolean;
    if (actor.role === 'partner') {
      p = (await this.partners.context(actor)).partner;
      fromPartner = true;
    } else {
      this.partners.assertView(actor);
      if (!partnerId) throw new NotFoundException('Partner not found.');
      p = await this.partners.find(tenantId, partnerId);
      fromPartner = false;
    }
    if (input.clientId) {
      const family = await this.partners.family(p.id);
      const [c] = await this.db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, input.clientId), inArray(clients.partnerId, family))).limit(1);
      if (!c) throw new ForbiddenException('That student is not this partner’s.');
    }
    await this.db.insert(partnerMessages).values({ tenantId, partnerId: p.id, authorId: actor.id, fromPartner, clientId: input.clientId ?? null, body: input.body });
    if (fromPartner) {
      const staff = await this.partners.staffFor(p);
      await this.notifications.pushMany(staff, { type: 'partner_update', title: `Message from ${p.name}`, body: input.body.slice(0, 160), link: `/overview/partners/${p.id}?tab=messages` });
    } else {
      await this.partners.tellPartner(p.id, { title: 'New message from the consultancy', body: input.body.slice(0, 160), link: '/partner/messages', email: true }, true);
    }
    return this.messages(actor, partnerId);
  }

  /* ---------------------------------------------------------------- */
  /* The marketing library                                             */
  /* ---------------------------------------------------------------- */

  /** Files in the folders the consultancy shares with partners (and the folders beneath them). */
  async resources(actor: AuthUser): Promise<{ folders: { id: string; name: string; files: { id: string; name: string; size: number; mime: string; uploadedAt: string }[] }[] }> {
    await this.partners.context(actor);
    const tenantId = tenantOf(actor);
    const shared = await this.db
      .select({ id: docFolders.id, name: docFolders.name, ancestry: docFolders.ancestry })
      .from(docFolders)
      .where(and(eq(docFolders.tenantId, tenantId), isNull(docFolders.clientId), eq(docFolders.sharedWithPartners, true), isNull(docFolders.trashedAt)))
      .orderBy(asc(docFolders.name));
    if (!shared.length) return { folders: [] };
    const folders = [];
    for (const f of shared) {
      const files = await this.db
        .select({ id: documents.id, name: documents.fileName, size: documents.fileSize, mime: documents.mimeType, uploadedAt: documents.uploadedAt })
        .from(documents)
        .innerJoin(docFolders, eq(docFolders.id, documents.folderId))
        .where(
          and(
            eq(documents.tenantId, tenantId),
            isNull(documents.clientId),
            isNull(documents.trashedAt),
            isNull(documents.deletedAt),
            isNull(documents.supersededBy),
            isNull(docFolders.trashedAt),
            or(eq(docFolders.id, f.id), sql`${docFolders.ancestry} like ${`%/${f.id}/%`}`),
          ),
        )
        .orderBy(asc(documents.fileName));
      folders.push({ id: f.id, name: f.name, files: files.map((x) => ({ ...x, uploadedAt: iso(x.uploadedAt) })) });
    }
    return { folders };
  }

  async resourceFile(actor: AuthUser, documentId: string): Promise<{ stream: Readable; name: string; mime: string }> {
    const ctx = await this.partners.context(actor);
    const lib = await this.resources(actor);
    const file = lib.folders.flatMap((f) => f.files).find((f) => f.id === documentId);
    if (!file) throw new NotFoundException('File not found.');
    const [d] = await this.db.select({ key: documents.fileKey }).from(documents).where(eq(documents.id, documentId)).limit(1);
    await this.audit.recordView(actor, { action: 'document.downloaded', entityType: 'document', entityId: documentId, metadata: { fileName: file.name, partner: ctx.partner.name } });
    return { stream: await this.storage.get(d!.key), name: file.name, mime: file.mime };
  }
}
