import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  computeTotals,
  convertQuoteSchema,
  formatMoney,
  quoteSchema,
  type AuthUser,
  type ConvertQuoteInput,
  type Currency,
  type FeeCategory,
  type InvoiceView,
  type Paginated,
  type PricedLineView,
  type QuoteInput,
  type QuoteStatus,
  type QuoteView,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { cases, clients, invoices, quotes, taxRates, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { seesAll } from '../auth/permissions';
import { NIL_UUID, iso, isoOrNull, page, today, withDocumentNumber } from '../common/db-helpers';
import { BillingService, type Priced } from '../billing/billing.service';
import { PdfService } from './pdf.service';

/** What a quote line stores: the priced line, plus what it was priced from. */
interface StoredLine extends PricedLineView {
  packageId: string | null;
  taxRateId: string | null;
  /** The line's own discount, before any share of the promotion. */
  lineDiscount: number;
}

/**
 * Quotes and proforma invoices. A quote is priced exactly like an invoice
 * (the same tax, discounts and promotion rules) and stored with its prices,
 * so when the student accepts it, the invoice is the quote - even if the
 * price list or a tax rate has changed since.
 */
@Injectable()
export class QuotesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly billing: BillingService,
    private readonly pdf: PdfService,
  ) {}

  private scope(actor: AuthUser): SQL | undefined {
    const tenant = eq(quotes.tenantId, tenantOf(actor));
    switch (actor.role) {
      case 'manager':
        return tenant;
      case 'consultant':
        return seesAll(actor) ? tenant : and(tenant, eq(clients.assignedConsultantId, actor.consultantId ?? NIL_UUID));
      case 'client':
        return and(tenant, eq(quotes.clientId, actor.clientId ?? NIL_UUID), ne(quotes.status, 'draft'));
      default:
        return sql`false`;
    }
  }

  async list(actor: AuthUser, q: { status?: string; clientId?: string; page?: number; pageSize?: number }): Promise<Paginated<QuoteView>> {
    const pageNo = Math.max(1, q.page ?? 1);
    const size = Math.min(100, Math.max(1, q.pageSize ?? 25));
    const day = today();
    const conds: (SQL | undefined)[] = [this.scope(actor)];
    if (q.clientId) conds.push(eq(quotes.clientId, q.clientId));
    if (q.status === 'expired') conds.push(eq(quotes.status, 'sent'), sql`${quotes.validUntil} < ${day}`);
    else if (q.status === 'sent') conds.push(eq(quotes.status, 'sent'), sql`${quotes.validUntil} >= ${day}`);
    else if (q.status && q.status !== 'all') conds.push(eq(quotes.status, q.status));
    const where = and(...conds);
    const [[count], rows] = await Promise.all([
      this.db.select({ n: sql<number>`count(*)::int` }).from(quotes).innerJoin(clients, eq(clients.id, quotes.clientId)).where(where),
      this.db
        .select({ id: quotes.id })
        .from(quotes)
        .innerJoin(clients, eq(clients.id, quotes.clientId))
        .where(where)
        .orderBy(desc(quotes.issueDate), desc(quotes.number))
        .limit(size)
        .offset((pageNo - 1) * size),
    ]);
    const items = await Promise.all(rows.map((r) => this.view(r.id)));
    return page(items, count?.n ?? 0, pageNo, size);
  }

  async get(actor: AuthUser, id: string): Promise<QuoteView> {
    const [row] = await this.db
      .select({ id: quotes.id })
      .from(quotes)
      .innerJoin(clients, eq(clients.id, quotes.clientId))
      .where(and(eq(quotes.id, id), this.scope(actor)))
      .limit(1);
    if (!row) throw new NotFoundException('Quote not found.');
    return this.view(id);
  }

  private async view(id: string): Promise<QuoteView> {
    const creator = alias(users, 'q_creator');
    const [r] = await this.db
      .select({ q: quotes, clientName: clients.fullName, clientEmail: clients.email, caseReference: cases.reference, invoiceNumber: invoices.number, createdByName: creator.fullName })
      .from(quotes)
      .innerJoin(clients, eq(clients.id, quotes.clientId))
      .leftJoin(cases, eq(cases.id, quotes.caseId))
      .leftJoin(invoices, eq(invoices.id, quotes.invoiceId))
      .leftJoin(creator, eq(creator.id, quotes.createdBy))
      .where(eq(quotes.id, id))
      .limit(1);
    if (!r) throw new NotFoundException('Quote not found.');
    const stored = r.q.items as unknown as StoredLine[];
    const status: QuoteStatus = r.q.status === 'sent' && r.q.validUntil < today() ? 'expired' : (r.q.status as QuoteStatus);
    return {
      id: r.q.id,
      number: r.q.number,
      clientId: r.q.clientId,
      clientName: r.clientName,
      clientEmail: r.clientEmail,
      caseId: r.q.caseId,
      caseReference: r.caseReference,
      currency: r.q.currency as Currency,
      issueDate: r.q.issueDate,
      validUntil: r.q.validUntil,
      status,
      proforma: r.q.proforma,
      items: stored.map(({ packageId: _p, taxRateId: _t, lineDiscount: _d, ...line }) => line),
      subtotal: r.q.subtotal,
      discount: r.q.discountTotal,
      tax: r.q.taxTotal,
      total: r.q.total,
      promoCode: r.q.promoSnapshot?.code ?? null,
      notes: r.q.notes,
      invoiceId: r.q.invoiceId,
      invoiceNumber: r.invoiceNumber,
      decisionNote: r.q.decisionNote,
      decidedAt: isoOrNull(r.q.decidedAt),
      createdByName: r.createdByName,
      createdAt: iso(r.q.createdAt),
    };
  }

  async create(actor: AuthUser, raw: QuoteInput): Promise<QuoteView> {
    if (actor.role !== 'manager' && actor.role !== 'consultant') throw new ForbiddenException('Only staff can write quotes.');
    const input = quoteSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const client = await this.billing.billableClient(actor, input.clientId);
    if (input.caseId) await this.billing.assertCaseOf(tenantId, client.id, input.caseId);
    const issueDate = input.issueDate ?? today();
    if (input.validUntil < issueDate) {
      throw new BadRequestException({ message: 'It expires before it is issued.', fieldErrors: { validUntil: 'Must be on or after today' } });
    }
    const priced = await this.billing.price(tenantId, input.currency, input.items, input.promoCode, issueDate);
    const lines = this.billing.pricedView(priced);
    const stored: StoredLine[] = lines.map((l, i) => ({
      ...l,
      packageId: priced.lines[i]!.input.packageId ?? null,
      taxRateId: priced.lines[i]!.rate?.id ?? null,
      lineDiscount: priced.lines[i]!.input.discount ?? 0,
    }));
    const row = await withDocumentNumber(this.db, quotes, tenantId, 'QUO', async (number) => {
      const [q] = await this.db
        .insert(quotes)
        .values({
          tenantId,
          number,
          clientId: client.id,
          caseId: input.caseId ?? null,
          currency: input.currency,
          issueDate,
          validUntil: input.validUntil,
          status: input.send ? 'sent' : 'draft',
          proforma: input.proforma,
          items: stored as unknown as Record<string, unknown>[],
          subtotal: priced.totals.subtotal,
          discountTotal: priced.totals.discount,
          taxTotal: priced.totals.tax,
          total: priced.totals.total,
          promoCodeId: priced.promo?.id ?? null,
          promoSnapshot: priced.promo,
          notes: input.notes,
          createdBy: actor.id,
        })
        .returning();
      return q!;
    });
    await this.audit.record(actor, {
      action: 'quote.saved',
      entityType: 'quote',
      entityId: row.id,
      clientId: client.id,
      metadata: { number: row.number, total: row.total, currency: row.currency, proforma: row.proforma, sent: input.send },
    });
    if (input.send) await this.deliver(tenantId, row.id);
    return this.view(row.id);
  }

  async send(actor: AuthUser, id: string): Promise<QuoteView> {
    const q = await this.get(actor, id);
    if (actor.role === 'client') throw new ForbiddenException();
    if (q.status !== 'draft' && q.status !== 'sent') throw new BadRequestException('Only a draft or open quote can be sent.');
    await this.db.update(quotes).set({ status: 'sent', updatedAt: new Date() }).where(eq(quotes.id, id));
    await this.audit.record(actor, { action: 'quote.saved', entityType: 'quote', entityId: id, clientId: q.clientId, metadata: { number: q.number, sent: true } });
    await this.deliver(tenantOf(actor), id);
    return this.view(id);
  }

  /** The student (or staff for them) accepts or declines an open quote. */
  async decide(actor: AuthUser, id: string, accept: boolean, note: string | null): Promise<QuoteView> {
    const q = await this.get(actor, id);
    if (q.status === 'expired') throw new BadRequestException(`This quote expired on ${q.validUntil}. Ask for a new one.`);
    if (q.status !== 'sent') throw new BadRequestException('This quote is not open for a decision.');
    await this.db
      .update(quotes)
      .set({ status: accept ? 'accepted' : 'declined', decisionNote: note, decidedAt: new Date(), decidedBy: actor.id, updatedAt: new Date() })
      .where(and(eq(quotes.id, id), eq(quotes.status, 'sent')));
    await this.audit.record(actor, { action: 'quote.saved', entityType: 'quote', entityId: id, clientId: q.clientId, metadata: { number: q.number, decision: accept ? 'accepted' : 'declined', note } });
    // Whoever wrote it hears the answer.
    const [author] = await this.db.select({ createdBy: quotes.createdBy }).from(quotes).where(eq(quotes.id, id));
    if (author?.createdBy && author.createdBy !== actor.id) {
      await this.notifications.push({
        userId: author.createdBy,
        type: 'invoice_issued',
        title: `${q.clientName} ${accept ? 'accepted' : 'declined'} quote ${q.number}`,
        body: note ?? (accept ? `Convert it to an invoice when ready (${formatMoney(q.total, q.currency)}).` : ''),
        link: `/desk/invoices/quotes/${id}`,
        email: true,
      });
    }
    return this.view(id);
  }

  /**
   * Issues the invoice for an accepted (or open) quote, at the quote's own
   * prices. A quote becomes one invoice, once.
   */
  async convert(actor: AuthUser, id: string, raw: ConvertQuoteInput): Promise<InvoiceView> {
    const input = convertQuoteSchema.parse(raw);
    const q = await this.get(actor, id);
    if (q.status !== 'accepted' && q.status !== 'sent') throw new BadRequestException(q.status === 'converted' ? 'This quote has already been invoiced.' : 'Only an open or accepted quote can be invoiced.');
    const [row] = await this.db.select().from(quotes).where(eq(quotes.id, id)).limit(1);
    const stored = row!.items as unknown as StoredLine[];
    const priced = this.repriced(tenantOf(actor), stored, row!.promoSnapshot ?? null);
    if (priced.totals.total !== q.total) throw new Error(`Quote ${q.number} re-prices to ${priced.totals.total}, not ${q.total}`);
    const invoice = await this.billing.createPriced(
      actor,
      { clientId: q.clientId, caseId: q.caseId ?? undefined, currency: q.currency, issueDate: today(), dueDate: input.dueDate, installments: input.installments, notes: q.notes ?? undefined },
      priced,
      { quoteId: id },
    );
    await this.db.update(quotes).set({ status: 'converted', invoiceId: invoice.id, updatedAt: new Date() }).where(eq(quotes.id, id));
    await this.audit.record(actor, { action: 'quote.converted', entityType: 'quote', entityId: id, clientId: q.clientId, metadata: { number: q.number, invoice: invoice.number } });
    return invoice;
  }

  async pdfFor(actor: AuthUser, id: string): Promise<{ file: Buffer; name: string }> {
    const q = await this.get(actor, id);
    return { file: await this.pdf.quote(tenantOf(actor), q), name: `${q.number}.pdf` };
  }

  /** The quote's lines as the pricing engine sees them, rates as they were then. */
  private repriced(tenantId: string, stored: StoredLine[], promo: Priced['promo']): Priced {
    const lines: Priced['lines'] = stored.map((l) => ({
      input: {
        description: l.description,
        packageId: l.packageId,
        quantity: l.quantity,
        unitAmount: l.unitAmount,
        category: l.category as FeeCategory,
        taxRateId: l.taxRateId,
        discount: l.lineDiscount,
      },
      category: l.category as FeeCategory,
      rate: l.taxRateId
        ? ({ id: l.taxRateId, tenantId, name: l.taxRateName ?? 'Tax', rateBp: l.taxRateBp, inclusive: l.taxInclusive, isDefault: false, active: true, createdAt: new Date(), updatedAt: new Date() } as typeof taxRates.$inferSelect)
        : null,
    }));
    const totals = computeTotals(
      lines.map((l) => ({ quantity: l.input.quantity, unitAmount: l.input.unitAmount, discount: l.input.discount ?? 0, tax: l.rate ? { rateBp: l.rate.rateBp, inclusive: l.rate.inclusive } : null })),
      promo,
    );
    return { lines, totals, promo };
  }

  /** To the student, with the PDF. */
  private async deliver(tenantId: string, id: string): Promise<void> {
    const q = await this.view(id);
    let attachments: { filename: string; content: Buffer; contentType: string }[] = [];
    try {
      attachments = [{ filename: `${q.number}.pdf`, content: await this.pdf.quote(tenantId, q), contentType: 'application/pdf' }];
    } catch {
      /* the message still goes without its PDF */
    }
    await this.billing.deliverToClient(tenantId, q.clientId, 'invoice_issued', {
      title: `${q.proforma ? 'Proforma invoice' : 'Quote'} ${q.number}: ${formatMoney(q.total, q.currency)}`,
      body: `Valid until ${q.validUntil}. You can accept or decline it in your portal.`,
      link: `/portal/payments/quotes/${q.id}`,
      attachments,
    });
  }
}
