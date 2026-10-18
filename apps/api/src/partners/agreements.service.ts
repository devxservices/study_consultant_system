import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { createHash } from 'node:crypto';
import {
  partnerAgreementSchema,
  signAgreementSchema,
  type AuthUser,
  type PartnerAgreementInput,
  type PartnerAgreementStatus,
  type PartnerAgreementView,
  type SignAgreementInput,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { partnerAgreements, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PdfService } from '../finance/pdf.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { tenantIdentity } from '../tenancy/tenant-links';
import { iso, isoOrNull, today } from '../common/db-helpers';
import { PartnersService } from './partners.service';

type Row = typeof partnerAgreements.$inferSelect;

/** What a signature is checked against: the terms exactly as they were sent. */
export function agreementHash(a: Pick<Row, 'title' | 'body' | 'validFrom' | 'validTo'>): string {
  return createHash('sha256').update(JSON.stringify([a.title, a.body, a.validFrom, a.validTo ?? null])).digest('hex');
}

/**
 * The partner agreement, signed in the app. Staff write it (from the
 * consultancy's template) and send it; the terms are frozen and hashed when
 * sent; the partner's owner or administrator reads it and signs - typing
 * their name or drawing it - and the signature is kept with who, when, from
 * where and the hash, which the certificate prints.
 */
@Injectable()
export class PartnerAgreementsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly pdf: PdfService,
    private readonly partners: PartnersService,
  ) {}

  async list(actor: AuthUser, partnerId: string): Promise<PartnerAgreementView[]> {
    if (actor.role === 'partner') {
      const ctx = await this.partners.context(actor);
      if (ctx.partner.id !== partnerId) throw new NotFoundException('Partner not found.');
      // Drafts are the consultancy's own until they are sent.
      return (await this.views(partnerId)).filter((a) => a.status !== 'draft');
    }
    this.partners.assertView(actor);
    await this.partners.find(tenantOf(actor), partnerId);
    return this.views(partnerId);
  }

  private async views(partnerId: string, ids?: string[]): Promise<PartnerAgreementView[]> {
    const sender = alias(users, 'sender');
    const rows = await this.db
      .select({ a: partnerAgreements, sentByName: sender.fullName })
      .from(partnerAgreements)
      .leftJoin(sender, eq(sender.id, partnerAgreements.sentBy))
      .where(and(eq(partnerAgreements.partnerId, partnerId), ids ? inArray(partnerAgreements.id, ids) : undefined))
      .orderBy(desc(partnerAgreements.version));
    return rows.map(({ a, sentByName }) => ({
      id: a.id,
      partnerId: a.partnerId,
      version: a.version,
      title: a.title,
      body: a.body,
      validFrom: a.validFrom,
      validTo: a.validTo,
      status: a.status as PartnerAgreementStatus,
      documentHash: a.documentHash,
      sentAt: isoOrNull(a.sentAt),
      sentByName,
      signedAt: isoOrNull(a.signedAt),
      signerName: a.signerName,
      signerTitle: a.signerTitle,
      signatureKind: a.signatureKind as 'typed' | 'drawn' | null,
      signature: a.signature,
      signerIp: a.signerIp,
      signerUserAgent: a.signerUserAgent,
      createdAt: iso(a.createdAt),
    }));
  }

  private async row(tenantId: string, partnerId: string, id: string): Promise<Row> {
    const [a] = await this.db
      .select()
      .from(partnerAgreements)
      .where(and(eq(partnerAgreements.id, id), eq(partnerAgreements.partnerId, partnerId), eq(partnerAgreements.tenantId, tenantId)))
      .limit(1);
    if (!a) throw new NotFoundException('Agreement not found.');
    return a;
  }

  /** The template with the partner's name, the consultancy's and today's date filled in. */
  async draftText(actor: AuthUser, partnerId: string): Promise<{ title: string; body: string; validFrom: string }> {
    this.partners.assertManage(actor);
    const tenantId = tenantOf(actor);
    const [p, settings, site] = await Promise.all([this.partners.find(tenantId, partnerId), this.partners.settings(tenantId), tenantIdentity(this.db, tenantId)]);
    const day = today();
    const body = settings.agreementTemplate
      .replaceAll('{partner}', p.name)
      .replaceAll('{consultancy}', site.name)
      .replaceAll('{date}', new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }));
    return { title: `Partner agreement: ${p.name}`, body, validFrom: day };
  }

  async create(actor: AuthUser, partnerId: string, raw: PartnerAgreementInput): Promise<PartnerAgreementView[]> {
    this.partners.assertManage(actor);
    const input = partnerAgreementSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const p = await this.partners.find(tenantId, partnerId);
    if (p.status === 'terminated') throw new BadRequestException('The partnership has ended.');
    const [open] = await this.db
      .select({ id: partnerAgreements.id })
      .from(partnerAgreements)
      .where(and(eq(partnerAgreements.partnerId, partnerId), eq(partnerAgreements.status, 'draft')))
      .limit(1);
    if (open) throw new BadRequestException('There is already a draft. Change it, or withdraw it first.');
    const [last] = await this.db.select({ v: partnerAgreements.version }).from(partnerAgreements).where(eq(partnerAgreements.partnerId, partnerId)).orderBy(desc(partnerAgreements.version)).limit(1);
    await this.db.insert(partnerAgreements).values({ tenantId, partnerId, version: (last?.v ?? 0) + 1, ...input, validTo: input.validTo ?? null, createdBy: actor.id });
    return this.list(actor, partnerId);
  }

  async update(actor: AuthUser, partnerId: string, id: string, raw: PartnerAgreementInput): Promise<PartnerAgreementView[]> {
    this.partners.assertManage(actor);
    const input = partnerAgreementSchema.parse(raw);
    const a = await this.row(tenantOf(actor), partnerId, id);
    if (a.status !== 'draft') throw new BadRequestException('Only a draft can be changed. Withdraw it and write a new one.');
    await this.db.update(partnerAgreements).set({ ...input, validTo: input.validTo ?? null, updatedAt: new Date() }).where(eq(partnerAgreements.id, id));
    return this.list(actor, partnerId);
  }

  /** Freezes the terms, hashes them, and asks the partner to sign. */
  async send(actor: AuthUser, partnerId: string, id: string): Promise<PartnerAgreementView[]> {
    this.partners.assertManage(actor);
    const tenantId = tenantOf(actor);
    const p = await this.partners.find(tenantId, partnerId);
    const a = await this.row(tenantId, partnerId, id);
    if (a.status !== 'draft') throw new BadRequestException('It has been sent already.');
    const members = await this.partners.members(partnerId);
    if (!members.some((m) => m.active && (m.role === 'owner' || m.role === 'admin'))) {
      throw new BadRequestException('Give someone at the partner a login (owner or administrator) first, so they can sign.');
    }
    // A newer agreement replaces one waiting to be signed.
    await this.db
      .update(partnerAgreements)
      .set({ status: 'void', updatedAt: new Date() })
      .where(and(eq(partnerAgreements.partnerId, partnerId), eq(partnerAgreements.status, 'sent'), ne(partnerAgreements.id, id)));
    await this.db.update(partnerAgreements).set({ status: 'sent', documentHash: agreementHash(a), sentAt: new Date(), sentBy: actor.id, updatedAt: new Date() }).where(eq(partnerAgreements.id, id));
    await this.audit.record(actor, { action: 'partner_agreement.sent', entityType: 'partner', entityId: partnerId, metadata: { partner: p.name, agreement: a.title, version: a.version } });
    await this.partners.tellPartner(partnerId, { title: 'Your partner agreement is ready to sign', body: a.title, link: '/partner/agreement', email: true });
    return this.list(actor, partnerId);
  }

  /** Staff withdraw a draft or an unsigned one, or end a signed one (a new one is then needed). */
  async withdraw(actor: AuthUser, partnerId: string, id: string, reason: string): Promise<PartnerAgreementView[]> {
    this.partners.assertManage(actor);
    const tenantId = tenantOf(actor);
    const a = await this.row(tenantId, partnerId, id);
    if (a.status === 'void') return this.list(actor, partnerId);
    await this.db.update(partnerAgreements).set({ status: 'void', updatedAt: new Date() }).where(eq(partnerAgreements.id, id));
    await this.audit.record(actor, { action: 'partner_agreement.sent', entityType: 'partner', entityId: partnerId, metadata: { agreement: a.title, version: a.version, withdrawn: true, was: a.status, reason } });
    if (a.status !== 'draft') await this.partners.tellPartner(partnerId, { title: 'Your partner agreement was withdrawn', body: reason, link: '/partner/agreement' });
    return this.list(actor, partnerId);
  }

  /** The partner's owner or administrator signs what was sent, as it was sent. */
  async sign(actor: AuthUser, id: string, raw: SignAgreementInput, from: { ip: string | null; userAgent: string | null }): Promise<PartnerAgreementView> {
    const ctx = await this.partners.context(actor);
    if (!ctx.canManage) throw new ForbiddenException('The owner or an administrator signs the agreement.');
    const input = signAgreementSchema.parse(raw);
    const a = await this.row(tenantOf(actor), ctx.partner.id, id);
    if (a.status === 'signed') throw new BadRequestException('It is signed already.');
    if (a.status !== 'sent') throw new BadRequestException('This agreement is not waiting for a signature.');
    if (a.documentHash !== agreementHash(a)) throw new BadRequestException('The terms changed after they were sent. Ask the consultancy to send them again.');
    if (a.validTo && a.validTo < today()) throw new BadRequestException('This agreement has expired. Ask the consultancy for a new one.');
    const updated = await this.db
      .update(partnerAgreements)
      .set({
        status: 'signed',
        signedAt: new Date(),
        signedBy: actor.id,
        signerName: input.signerName,
        signerTitle: input.signerTitle,
        signatureKind: input.kind,
        signature: input.signature,
        signerIp: from.ip,
        signerUserAgent: from.userAgent?.slice(0, 400) ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(partnerAgreements.id, id), eq(partnerAgreements.status, 'sent')))
      .returning({ id: partnerAgreements.id });
    if (!updated.length) throw new BadRequestException('It has just been signed or withdrawn. Reload the page.');
    await this.audit.record(actor, {
      action: 'partner_agreement.signed',
      entityType: 'partner',
      entityId: ctx.partner.id,
      metadata: { partner: ctx.partner.name, agreement: a.title, version: a.version, signer: input.signerName, kind: input.kind, ip: from.ip, hash: a.documentHash },
    });
    const staff = await this.partners.staffFor(ctx.partner);
    await this.notifications.pushMany(staff, {
      type: 'partner_update',
      title: `${ctx.partner.name} signed the partner agreement`,
      body: `${input.signerName}, ${input.signerTitle}.`,
      link: `/overview/partners/${ctx.partner.id}`,
      email: true,
    });
    return (await this.views(ctx.partner.id, [id]))[0]!;
  }

  /** The agreement as signed, with its signature and audit certificate. */
  async certificate(actor: AuthUser, partnerId: string, id: string): Promise<{ pdf: Buffer; name: string }> {
    if (actor.role === 'partner') {
      const ctx = await this.partners.context(actor);
      if (ctx.partner.id !== partnerId) throw new NotFoundException('Agreement not found.');
    } else this.partners.assertView(actor);
    const tenantId = tenantOf(actor);
    const p = await this.partners.find(tenantId, partnerId);
    const [a] = await this.views(partnerId, [id]);
    if (!a || a.status === 'draft') throw new NotFoundException('Agreement not found.');
    const pdf = await this.pdf.partnerAgreement(tenantId, a, { name: p.name, number: p.number, address: [p.address, p.city, p.country].filter(Boolean).join(', ') });
    return { pdf, name: `${p.number}-agreement-v${a.version}.pdf` };
  }
}
