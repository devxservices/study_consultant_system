import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  addCalendarMonths,
  allocateInstallments,
  billLineSchema,
  computeTotals,
  createInvoiceSchema,
  creditNoteSchema,
  formatMoney,
  localIsoDate,
  localIsoDateIn,
  installmentPlanSchema,
  METHOD_ACCOUNT,
  paymentStatus,
  recordPaymentSchema,
  type AuthUser,
  type BillLineInput,
  type BillingTotals,
  type CreateInvoiceInput,
  type CreditNoteInput,
  type Currency,
  type FeeCategory,
  type InstallmentPlanInput,
  type InvoiceStatus,
  type InvoiceSummaryView,
  type InvoiceView,
  type ListInvoicesQuery,
  type NotificationType,
  type Paginated,
  type PaymentKind,
  type PaymentMethod,
  type PaymentView,
  type PricedLineView,
  type RecordPaymentInput,
  type ServicePackageInput,
  type ServicePackageView,
  type StatementLine,
  type StatementView,
  type Totals,
} from '@crm/shared';
import { z } from 'zod';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import {
  cases,
  clients,
  creditNotes,
  installments,
  invoiceItems,
  invoices,
  ledgerAccounts,
  payments,
  promoCodes,
  quotes,
  servicePackages,
  taxRates,
  tenants,
  users,
} from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService, textToHtml, type MailAttachment } from '../mail/mail.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { tenantIdentity } from '../tenancy/tenant-links';
import { seesAll, staffCan } from '../auth/permissions';
import { NIL_UUID, iso, isoOrNull, today, withDocumentNumber } from '../common/db-helpers';
import { permissionHolders } from '../common/permission-holders';
import { FinanceSettingsService } from '../finance/finance-settings.service';
import { PdfService } from '../finance/pdf.service';
import {
  assertMoneyAccount,
  creditNoteLines,
  liveEntryFor,
  postEntry,
  postInvoice,
  postPayment,
  reverseEntry,
  systemAccountId,
} from '../finance/journal';
import { creditNoteRows, ofInvoice, refundRequestRows, submissionRows } from '../finance/views';

/** The outer invoice, named explicitly so the correlated subqueries bind to it. */
const INVOICE_ID = sql.raw('"invoices"."id"');

/**
 * What has actually been paid on an invoice: payments less refunds, voided
 * entries excluded. Computed from the ledger every time rather than stored,
 * so it cannot drift from the ledger.
 */
export const paidSql = sql<number>`coalesce((
  select sum(case when p.kind = 'payment' then p.amount else -p.amount end)
  from payments p
  where p.invoice_id = ${INVOICE_ID} and p.voided_at is null
), 0)::bigint`;

/** Credit notes against it, voided ones excluded. */
export const creditedSql = sql<number>`coalesce((
  select sum(cn.amount) from credit_notes cn
  where cn.invoice_id = ${INVOICE_ID} and cn.voided_at is null
), 0)::bigint`;

const hasPlanSql = sql`exists (select 1 from installments x where x.invoice_id = ${INVOICE_ID})`;

/**
 * Overdue, in SQL. With installments, an invoice is late exactly when more
 * has fallen due than has been settled (installments are settled in date
 * order); without, when its due date has passed with money still owed.
 */
export const overdueSql = (day: string) => sql`(${invoices.status} = 'issued'
  and ${invoices.total} - ${paidSql} - ${creditedSql} > 0
  and case when ${hasPlanSql}
    then coalesce((select sum(x.amount) from installments x where x.invoice_id = ${INVOICE_ID} and x.due_date < ${day}), 0) > ${paidSql} + ${creditedSql}
    else ${invoices.dueDate} < ${day} end)`;

/** A line as priced: the input, its fee kind, its tax rate and the arithmetic. */
interface PricedLine {
  input: z.output<typeof billLineSchema>;
  category: FeeCategory;
  rate: typeof taxRates.$inferSelect | null;
}

export interface Priced {
  lines: PricedLine[];
  totals: Totals;
  promo: { id: string; kind: 'percent' | 'fixed'; value: number; code: string } | null;
}

/** What `issue` needs; everything validated before it gets here. */
interface IssueData {
  clientId: string;
  caseId: string | null;
  currency: string;
  issueDate: string;
  dueDate: string;
  priced: Priced;
  status: 'issued' | 'pending_approval';
  notes: string | null;
  discountReason: string | null;
  fxRate: number | null;
  createdBy: string | null;
  installments: { dueDate: string; amount: number; label: string | null }[];
  parentInvoiceId?: string | null;
  quoteId?: string | null;
}

/**
 * Invoices and the payments ledger, with the books underneath.
 *
 * Who may do what:
 *  - a manager sees and does everything in their consultancy;
 *  - a consultant invoices and takes payments for their own clients (or
 *    everyone's, with "see every client"); refunds, voids, credit notes and
 *    discount approvals need "Approve refunds and discounts";
 *  - a client reads their own issued invoices, receipts and statement.
 *
 * Every invoice, payment, refund, credit note and void posts to the journal
 * inside the same transaction as the row it describes, so the books and the
 * invoices can never disagree.
 */
/** Money a student paid (or was refunded), or a payment voided - for modules that share in it (partner fee shares). */
export interface PaymentEvent {
  tenantId: string;
  paymentId: string;
  invoiceId: string;
  clientId: string;
  kind: PaymentKind;
  amount: number;
  currency: string;
  receivedOn: string;
  fxRate: number | null;
  voided: boolean;
  actor: AuthUser | null;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly paymentListeners: ((e: PaymentEvent) => Promise<void>)[] = [];

  /** Hears every payment, refund and void after it is recorded. A listener that fails never undoes the payment. */
  onPayment(fn: (e: PaymentEvent) => Promise<void>): void {
    this.paymentListeners.push(fn);
  }

  private async emitPayment(e: PaymentEvent): Promise<void> {
    for (const fn of this.paymentListeners) {
      try {
        await fn(e);
      } catch (err) {
        this.logger.error(`A payment listener failed on ${e.paymentId}`, err as Error);
      }
    }
  }

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly settings: FinanceSettingsService,
    private readonly pdf: PdfService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Scope                                                             */
  /* ---------------------------------------------------------------- */

  /** Invoice rows this actor may see. Expects `clients` joined on invoices.client_id. */
  scope(actor: AuthUser): SQL | undefined {
    const tenant = eq(invoices.tenantId, tenantOf(actor));
    switch (actor.role) {
      case 'manager':
        return tenant;
      case 'consultant':
        if (seesAll(actor)) return tenant;
        return and(tenant, eq(clients.assignedConsultantId, actor.consultantId ?? NIL_UUID));
      case 'client':
        // A student never sees an invoice still waiting for approval.
        return and(tenant, eq(invoices.clientId, actor.clientId ?? NIL_UUID), ne(invoices.status, 'pending_approval'));
      default:
        return sql`false`;
    }
  }

  private assertStaff(actor: AuthUser): void {
    if (actor.role !== 'manager' && actor.role !== 'consultant') {
      throw new ForbiddenException('Only staff can do this.');
    }
  }

  /** Refunds, voids, credit notes and over-limit discounts: a manager, or "Approve refunds and discounts". */
  canApprove(actor: AuthUser): boolean {
    return actor.role === 'manager' || staffCan(actor, 'billing.approve');
  }

  private assertApprover(actor: AuthUser, what: string): void {
    if (!this.canApprove(actor)) throw new ForbiddenException(`You need “Approve refunds and discounts” to ${what}.`);
  }

  /** A client this actor may bill. */
  async billableClient(actor: AuthUser, clientId: string) {
    const [client] = await this.db
      .select({ id: clients.id, userId: clients.userId, fullName: clients.fullName, email: clients.email })
      .from(clients)
      .where(
        and(
          eq(clients.id, clientId),
          eq(clients.tenantId, tenantOf(actor)),
          actor.role === 'consultant' && !seesAll(actor) ? eq(clients.assignedConsultantId, actor.consultantId ?? NIL_UUID) : undefined,
        ),
      )
      .limit(1);
    if (!client) throw new NotFoundException('Client not found.');
    return client;
  }

  async assertCaseOf(tenantId: string, clientId: string, caseId: string): Promise<void> {
    const [kase] = await this.db
      .select({ id: cases.id })
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.clientId, clientId), eq(cases.tenantId, tenantId)))
      .limit(1);
    if (!kase) {
      throw new BadRequestException({ message: 'That application is not this client’s.', fieldErrors: { caseId: 'Pick one of this client’s applications.' } });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Packages                                                          */
  /* ---------------------------------------------------------------- */

  async packages(actor: AuthUser, includeInactive = false): Promise<ServicePackageView[]> {
    this.assertStaff(actor);
    const rows = await this.db
      .select()
      .from(servicePackages)
      .where(and(eq(servicePackages.tenantId, tenantOf(actor)), includeInactive ? undefined : eq(servicePackages.active, true)))
      .orderBy(desc(servicePackages.active), asc(servicePackages.name));
    return rows.map(toPackage);
  }

  async savePackage(actor: AuthUser, input: ServicePackageInput, id?: string): Promise<ServicePackageView> {
    if (!staffCan(actor, 'finance.settings')) throw new ForbiddenException('You do not have permission to change the fee catalogue.');
    const tenantId = tenantOf(actor);
    if (input.taxRateId) await this.settings.ratesById(tenantId, [input.taxRateId]);
    const values = {
      name: input.name,
      description: input.description ?? null,
      amount: input.amount,
      currency: input.currency,
      active: input.active,
      category: input.category,
      taxRateId: input.taxRateId ?? null,
    };
    let row: typeof servicePackages.$inferSelect | undefined;
    if (id) {
      [row] = await this.db
        .update(servicePackages)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(servicePackages.id, id), eq(servicePackages.tenantId, tenantId)))
        .returning();
      if (!row) throw new NotFoundException('Package not found.');
    } else {
      [row] = await this.db.insert(servicePackages).values({ tenantId, ...values }).returning();
    }
    await this.audit.record(actor, { action: 'catalog.updated', entityType: 'settings', entityId: row!.id, metadata: { package: row!.name, amount: row!.amount, currency: row!.currency, category: row!.category } });
    return toPackage(row!);
  }

  /* ---------------------------------------------------------------- */
  /* Pricing                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Prices lines the way an invoice will: each line's fee kind and tax from
   * what was chosen, or from its package; the promotion checked and applied;
   * the totals from the one shared calculation.
   */
  async price(tenantId: string, currency: string, rawItems: BillLineInput[], promoCode?: string | null, on?: string): Promise<Priced> {
    const items = rawItems.map((i) => billLineSchema.parse(i));
    const packageIds = [...new Set(items.map((i) => i.packageId).filter((v): v is string => Boolean(v)))];
    const pkgs = packageIds.length
      ? await this.db
          .select({ id: servicePackages.id, category: servicePackages.category, taxRateId: servicePackages.taxRateId })
          .from(servicePackages)
          .where(and(inArray(servicePackages.id, packageIds), eq(servicePackages.tenantId, tenantId)))
      : [];
    if (pkgs.length !== packageIds.length) throw new BadRequestException('One of those packages is not in your price list.');
    const byPkg = new Map(pkgs.map((p) => [p.id, p]));

    const rateIdOf = (i: (typeof items)[number]) => (i.taxRateId !== undefined ? i.taxRateId : i.packageId ? (byPkg.get(i.packageId)?.taxRateId ?? null) : null);
    const rateIds = [...new Set(items.map(rateIdOf).filter((v): v is string => Boolean(v)))];
    const rates = await this.settings.ratesById(tenantId, rateIds);
    items.forEach((i, n) => {
      if ((i.discount ?? 0) > i.quantity * i.unitAmount) {
        throw new BadRequestException({ message: `Line ${n + 1}: the discount is more than the line.`, fieldErrors: { items: 'Discount above the line amount' } });
      }
    });
    const promo = promoCode ? await this.settings.resolvePromo(tenantId, promoCode, currency, on) : null;
    const lines: PricedLine[] = items.map((i) => {
      const rateId = rateIdOf(i);
      return {
        input: i,
        category: (i.category ?? (i.packageId ? (byPkg.get(i.packageId)?.category as FeeCategory) : undefined) ?? 'service') as FeeCategory,
        rate: rateId ? (rates.get(rateId) ?? null) : null,
      };
    });
    const totals = computeTotals(
      lines.map((l) => ({
        quantity: l.input.quantity,
        unitAmount: l.input.unitAmount,
        discount: l.input.discount ?? 0,
        tax: l.rate ? { rateBp: l.rate.rateBp, inclusive: l.rate.inclusive } : null,
      })),
      promo,
    );
    return { lines, totals, promo };
  }

  /** The priced lines as they print. */
  pricedView(p: Priced): PricedLineView[] {
    return p.lines.map((l, i) => {
      const r = p.totals.lines[i]!;
      return {
        description: l.input.description,
        quantity: l.input.quantity,
        unitAmount: l.input.unitAmount,
        amount: r.amount,
        discount: r.discount,
        taxRateName: l.rate?.name ?? null,
        taxRateBp: l.rate?.rateBp ?? 0,
        taxInclusive: l.rate?.inclusive ?? false,
        tax: r.tax,
        total: r.total,
        category: l.category,
      };
    });
  }

  /** Over the consultancy's discount limit, so someone else must approve it. */
  async needsApproval(tenantId: string, totals: Totals): Promise<boolean> {
    const s = await this.settings.row(tenantId);
    if (s.discountApprovalBp === null || totals.subtotal <= 0 || totals.discount <= 0) return false;
    return totals.discount * 10_000 > totals.subtotal * s.discountApprovalBp;
  }

  /* ---------------------------------------------------------------- */
  /* Invoices                                                          */
  /* ---------------------------------------------------------------- */

  async list(actor: AuthUser, query: ListInvoicesQuery): Promise<Paginated<InvoiceSummaryView>> {
    const day = today();
    const conditions: (SQL | undefined)[] = [this.scope(actor)];
    if (query.clientId) conditions.push(eq(invoices.clientId, query.clientId));
    if (query.caseId) conditions.push(eq(invoices.caseId, query.caseId));
    if (query.q) {
      const term = `%${query.q}%`;
      conditions.push(or(ilike(invoices.number, term), ilike(clients.fullName, term)));
    }
    const balance = sql`(${invoices.total} - ${paidSql} - ${creditedSql})`;
    switch (query.status) {
      case 'open':
        conditions.push(eq(invoices.status, 'issued'), sql`${balance} > 0`);
        break;
      case 'overdue':
        conditions.push(overdueSql(day));
        break;
      case 'paid':
        conditions.push(eq(invoices.status, 'issued'), sql`${balance} <= 0`);
        break;
      case 'void':
        conditions.push(eq(invoices.status, 'void'));
        break;
      case 'pending':
        conditions.push(eq(invoices.status, 'pending_approval'));
        break;
    }
    const where = and(...conditions);

    const [[total], rows] = await Promise.all([
      this.db.select({ n: sql<number>`count(*)::int` }).from(invoices).innerJoin(clients, eq(clients.id, invoices.clientId)).where(where),
      this.db
        .select(this.summarySelection(day))
        .from(invoices)
        .innerJoin(clients, eq(clients.id, invoices.clientId))
        .leftJoin(cases, eq(cases.id, invoices.caseId))
        .where(where)
        .orderBy(desc(invoices.issueDate), desc(invoices.number))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
    ]);
    const plans = await this.plansFor(rows.map((r) => r.id));
    const n = total?.n ?? 0;
    return {
      items: rows.map((r) => toSummary(r, plans.get(r.id), day)),
      page: query.page,
      pageSize: query.pageSize,
      total: n,
      totalPages: Math.max(1, Math.ceil(n / query.pageSize)),
    };
  }

  async get(actor: AuthUser, id: string): Promise<InvoiceView> {
    const [row] = await this.db
      .select({ id: invoices.id })
      .from(invoices)
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(and(eq(invoices.id, id), this.scope(actor)))
      .limit(1);
    if (!row) throw new NotFoundException('Invoice not found.');
    return this.view(tenantOf(actor), id, actor);
  }

  /**
   * The full invoice, for a consultancy - no actor scope. Callers check
   * access first (get does); system work (the sweep, a gateway) uses it as is.
   */
  async view(tenantId: string, id: string, actor?: AuthUser): Promise<InvoiceView> {
    const day = today();
    const creator = alias(users, 'creator');
    const approver = alias(users, 'approver');
    const parent = alias(invoices, 'parent');
    const [row] = await this.db
      .select({
        ...this.summarySelection(day),
        notes: invoices.notes,
        voidReason: invoices.voidReason,
        voidedAt: invoices.voidedAt,
        createdAt: invoices.createdAt,
        createdById: invoices.createdBy,
        createdByName: creator.fullName,
        clientEmail: clients.email,
        clientPhone: clients.phone,
        subtotal: invoices.subtotal,
        discountTotal: invoices.discountTotal,
        taxTotal: invoices.taxTotal,
        promoCode: promoCodes.code,
        discountReason: invoices.discountReason,
        fxRate: invoices.fxRate,
        approvedByName: approver.fullName,
        approvedAt: invoices.approvedAt,
        quoteNumber: quotes.number,
        parentId: parent.id,
        parentNumber: parent.number,
      })
      .from(invoices)
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .leftJoin(cases, eq(cases.id, invoices.caseId))
      .leftJoin(creator, eq(creator.id, invoices.createdBy))
      .leftJoin(approver, eq(approver.id, invoices.approvedBy))
      .leftJoin(promoCodes, eq(promoCodes.id, invoices.promoCodeId))
      .leftJoin(quotes, eq(quotes.id, invoices.quoteId))
      .leftJoin(parent, eq(parent.id, invoices.parentInvoiceId))
      .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException('Invoice not found.');

    const isClient = actor?.role === 'client';
    const [items, ledger, plan, credits, refunds, submissions] = await Promise.all([
      this.db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)).orderBy(asc(invoiceItems.position)),
      this.ledgerRows(and(eq(payments.tenantId, tenantId), eq(payments.invoiceId, id))),
      this.db.select().from(installments).where(eq(installments.invoiceId, id)).orderBy(asc(installments.seq)),
      creditNoteRows(this.db, ofInvoice.creditNotes(tenantId, id)),
      isClient ? Promise.resolve([]) : refundRequestRows(this.db, ofInvoice.refunds(tenantId, id)),
      submissionRows(this.db, ofInvoice.submissions(tenantId, id)),
    ]);
    const summary = toSummary(row, plan, day);
    const settled = summary.paid + summary.credited;
    return {
      ...summary,
      items: items.map((i) => ({
        id: i.id,
        description: i.description,
        quantity: i.quantity,
        unitAmount: i.unitAmount,
        amount: i.amount,
        discount: i.discount,
        category: i.category as FeeCategory,
        taxRateName: i.taxRateName,
        taxRateBp: i.taxRateBp,
        taxInclusive: i.taxInclusive,
        tax: i.taxAmount,
        total: i.lineTotal,
      })),
      payments: ledger,
      notes: row.notes,
      voidReason: row.voidReason,
      voidedAt: isoOrNull(row.voidedAt),
      createdByName: row.createdByName,
      createdById: row.createdById,
      createdAt: iso(row.createdAt),
      clientEmail: row.clientEmail,
      clientPhone: row.clientPhone,
      subtotal: Number(row.subtotal),
      discount: Number(row.discountTotal),
      tax: Number(row.taxTotal),
      promoCode: row.promoCode,
      discountReason: row.discountReason,
      fxRate: row.fxRate === null ? null : Number(row.fxRate),
      approvedByName: row.approvedByName,
      approvedAt: isoOrNull(row.approvedAt),
      quoteNumber: row.quoteNumber,
      parentInvoice: row.parentId ? { id: row.parentId, number: row.parentNumber! } : null,
      installments: allocateInstallments(
        plan.map((p) => ({ id: p.id, seq: p.seq, label: p.label, dueDate: p.dueDate, amount: p.amount, lateFeeInvoiceId: p.lateFeeInvoiceId })),
        settled,
        day,
      ),
      creditNotes: credits,
      refundRequests: refunds,
      submissions: isClient ? submissions.filter((s) => s.clientId === actor?.clientId) : submissions,
    };
  }

  /**
   * Issues an invoice (or, when its discount is over the consultancy's limit
   * and the issuer cannot approve it, files it for approval). The lines and
   * total are fixed from this moment: a mistake is corrected by a credit
   * note, or by voiding it and issuing another, never by editing.
   */
  async create(actor: AuthUser, raw: CreateInvoiceInput): Promise<InvoiceView> {
    this.assertStaff(actor);
    const input = createInvoiceSchema.parse(raw);
    const issueDate = input.issueDate ?? today();
    const priced = await this.price(tenantOf(actor), input.currency, input.items, input.promoCode, issueDate);
    return this.createPriced(actor, { ...input, issueDate }, priced);
  }

  /**
   * Issues lines already priced - by `create`, or exactly as a quote the
   * student accepted priced them, so the invoice matches what they agreed to.
   */
  async createPriced(
    actor: AuthUser,
    input: Omit<z.output<typeof createInvoiceSchema>, 'items' | 'promoCode'> & { issueDate: string },
    priced: Priced,
    opts: { quoteId?: string } = {},
  ): Promise<InvoiceView> {
    this.assertStaff(actor);
    const tenantId = tenantOf(actor);
    const client = await this.billableClient(actor, input.clientId);
    if (input.caseId) await this.assertCaseOf(tenantId, client.id, input.caseId);
    const issueDate = input.issueDate;
    const plan = this.checkPlan(input.installments ?? [], priced.totals.total, issueDate);
    const dueDate = plan.length ? plan[plan.length - 1]!.dueDate : input.dueDate;
    if (dueDate < issueDate) {
      throw new BadRequestException({ message: 'The due date is before the issue date.', fieldErrors: { dueDate: 'Must be on or after the issue date.' } });
    }
    const pending = (await this.needsApproval(tenantId, priced.totals)) && !this.canApprove(actor);
    if (pending && !input.discountReason) {
      throw new BadRequestException({
        message: 'This discount is over your consultancy’s limit, so it goes for approval. Say why it was given.',
        fieldErrors: { discountReason: 'Explain the discount for whoever approves it' },
      });
    }
    const base = (await this.settings.row(tenantId)).baseCurrency;

    const invoice = await this.issue(tenantId, {
      clientId: client.id,
      caseId: input.caseId ?? null,
      currency: input.currency,
      issueDate,
      dueDate,
      priced,
      status: pending ? 'pending_approval' : 'issued',
      notes: input.notes ?? null,
      discountReason: input.discountReason ?? null,
      fxRate: input.currency === base ? 1 : (input.fxRate ?? null),
      createdBy: actor.id,
      installments: plan,
      quoteId: opts.quoteId ?? null,
    });

    await this.audit.record(actor, {
      action: 'invoice.created',
      entityType: 'invoice',
      entityId: invoice.id,
      clientId: client.id,
      caseId: input.caseId ?? null,
      metadata: {
        number: invoice.number,
        total: priced.totals.total,
        currency: input.currency,
        discount: priced.totals.discount,
        tax: priced.totals.tax,
        promo: priced.promo?.code ?? null,
        installments: plan.length,
        pendingApproval: pending,
      },
    });
    if (plan.length) {
      await this.audit.record(actor, { action: 'installments.set', entityType: 'invoice', entityId: invoice.id, clientId: client.id, metadata: { count: plan.length } });
    }

    if (pending) {
      const approvers = await permissionHolders(this.db, tenantId, 'billing.approve', { exclude: actor.id });
      await this.notifications.pushMany(approvers, {
        type: 'approval_needed',
        title: `Invoice ${invoice.number} needs approval`,
        body: `${client.fullName}: a discount of ${formatMoney(priced.totals.discount, input.currency)} on ${formatMoney(priced.totals.subtotal, input.currency)}. ${input.discountReason ?? ''}`.trim(),
        link: `/overview/finance/invoices/${invoice.id}`,
        email: true,
      });
    } else if (input.sendEmail !== false) {
      await this.announceInvoice(tenantId, invoice.id);
    }
    return this.get(actor, invoice.id);
  }

  /**
   * Writes an invoice, its lines and installments, and - when it is issued
   * rather than waiting for approval - its journal entry, in one
   * transaction, under the next number.
   */
  async issue(tenantId: string, d: IssueData): Promise<typeof invoices.$inferSelect> {
    const t = d.priced.totals;
    return withDocumentNumber(this.db, invoices, tenantId, 'INV', (number) =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(invoices)
          .values({
            tenantId,
            number,
            clientId: d.clientId,
            caseId: d.caseId,
            currency: d.currency,
            issueDate: d.issueDate,
            dueDate: d.dueDate,
            status: d.status,
            total: t.total,
            subtotal: t.subtotal,
            discountTotal: t.discount,
            taxTotal: t.tax,
            promoCodeId: d.priced.promo?.id ?? null,
            discountReason: d.discountReason,
            fxRate: d.fxRate === null ? null : String(d.fxRate),
            quoteId: d.quoteId ?? null,
            parentInvoiceId: d.parentInvoiceId ?? null,
            notes: d.notes,
            createdBy: d.createdBy,
          })
          .returning();
        const lines = d.priced.lines.map((l, position) => {
          const r = t.lines[position]!;
          return {
            tenantId,
            invoiceId: row!.id,
            packageId: l.input.packageId ?? null,
            description: l.input.description,
            quantity: l.input.quantity,
            unitAmount: l.input.unitAmount,
            amount: r.amount,
            position,
            category: l.category,
            discount: r.discount,
            taxRateId: l.rate?.id ?? null,
            taxRateName: l.rate?.name ?? null,
            taxRateBp: l.rate?.rateBp ?? 0,
            taxInclusive: l.rate?.inclusive ?? false,
            taxAmount: r.tax,
            lineTotal: r.total,
          };
        });
        await tx.insert(invoiceItems).values(lines);
        if (d.installments.length) {
          await tx.insert(installments).values(
            d.installments.map((p, i) => ({ tenantId, invoiceId: row!.id, seq: i + 1, label: p.label, dueDate: p.dueDate, amount: p.amount })),
          );
        }
        if (d.status === 'issued') {
          await postInvoice(
            tx,
            { ...row!, total: t.total, items: lines.map((l) => ({ category: l.category, amount: l.amount, discount: l.discount, taxAmount: l.taxAmount, taxInclusive: l.taxInclusive })) },
            d.createdBy,
          );
        }
        return row!;
      }),
    );
  }

  private checkPlan(raw: InstallmentPlanInput['installments'], total: number, issueDate: string) {
    if (!raw.length) return [];
    const plan = installmentPlanSchema.parse({ installments: raw }).installments;
    const sum = plan.reduce((n, p) => n + p.amount, 0);
    if (sum !== total) {
      throw new BadRequestException({
        message: `The installments add up to ${sum / 100}, but the invoice is ${total / 100}. They must match.`,
        fieldErrors: { installments: 'Must add up to the invoice total' },
      });
    }
    if (plan[0]!.dueDate < issueDate) {
      throw new BadRequestException({ message: 'The first installment is due before the invoice is issued.', fieldErrors: { installments: 'Starts before the issue date' } });
    }
    return plan.map((p) => ({ dueDate: p.dueDate, amount: p.amount, label: p.label ?? null }));
  }

  /** Approves an invoice that was waiting: it is issued, booked and sent. Never by whoever wrote it. */
  async approve(actor: AuthUser, id: string, note: string | null): Promise<InvoiceView> {
    this.assertApprover(actor, 'approve a discount');
    const tenantId = tenantOf(actor);
    const inv = await this.get(actor, id);
    if (inv.status !== 'pending_approval') throw new BadRequestException('This invoice is not waiting for approval.');
    if (inv.createdById === actor.id) throw new ForbiddenException('Someone else has to approve a discount you gave.');
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(invoices)
        .set({ status: 'issued', approvedBy: actor.id, approvedAt: new Date() })
        .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId), eq(invoices.status, 'pending_approval')))
        .returning();
      if (!row) throw new BadRequestException('This invoice is not waiting for approval.');
      await postInvoice(
        tx,
        { ...row, items: inv.items.map((i) => ({ category: i.category, amount: i.amount, discount: i.discount, taxAmount: i.tax, taxInclusive: i.taxInclusive })) },
        actor.id,
      );
    });
    await this.audit.record(actor, { action: 'invoice.approved', entityType: 'invoice', entityId: id, clientId: inv.clientId, metadata: { number: inv.number, discount: inv.discount, note } });
    if (inv.createdById) {
      await this.notifications.push({ userId: inv.createdById, type: 'approval_needed', title: `Invoice ${inv.number} approved`, body: note ?? 'It has been issued to the student.', link: `/desk/invoices/${id}` });
    }
    await this.announceInvoice(tenantId, id);
    return this.get(actor, id);
  }

  /** Turns down an invoice that was waiting: it is voided, never having been issued. */
  async rejectPending(actor: AuthUser, id: string, reason: string): Promise<InvoiceView> {
    this.assertApprover(actor, 'turn down a discount');
    const inv = await this.get(actor, id);
    if (inv.status !== 'pending_approval') throw new BadRequestException('This invoice is not waiting for approval.');
    await this.db
      .update(invoices)
      .set({ status: 'void', voidReason: `Not approved: ${reason}`, voidedAt: new Date(), voidedBy: actor.id })
      .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantOf(actor))));
    await this.audit.record(actor, { action: 'invoice.voided', entityType: 'invoice', entityId: id, clientId: inv.clientId, metadata: { number: inv.number, reason, notApproved: true } });
    if (inv.createdById) {
      await this.notifications.push({ userId: inv.createdById, type: 'approval_needed', title: `Invoice ${inv.number} was not approved`, body: reason, link: `/desk/invoices/${id}` });
    }
    return this.get(actor, id);
  }

  /** Voids an invoice with nothing paid or credited against it. The row, its reason and a reversing entry stay. */
  async voidInvoice(actor: AuthUser, id: string, reason: string): Promise<InvoiceView> {
    this.assertApprover(actor, 'void an invoice');
    const tenantId = tenantOf(actor);
    const invoice = await this.get(actor, id);
    if (invoice.status === 'void') return invoice;
    if (invoice.status === 'pending_approval') return this.rejectPending(actor, id, reason);
    if (invoice.payments.some((p) => !p.voided)) {
      throw new BadRequestException('This invoice has payments recorded against it. Void or refund them first, so the ledger still adds up.');
    }
    if (invoice.creditNotes.some((c) => !c.voided)) {
      throw new BadRequestException('This invoice has credit notes. Void them first, or keep the invoice and credit the rest.');
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(invoices)
        .set({ status: 'void', voidReason: reason, voidedAt: new Date(), voidedBy: actor.id })
        .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));
      const entry = await liveEntryFor(tx, tenantId, 'invoice', id);
      if (entry) await reverseEntry(tx, entry, { date: today(), memo: `Invoice ${invoice.number} voided: ${reason}`, sourceType: 'invoice_void', createdBy: actor.id });
    });
    await this.audit.record(actor, { action: 'invoice.voided', entityType: 'invoice', entityId: id, clientId: invoice.clientId, metadata: { number: invoice.number, reason } });
    return this.get(actor, id);
  }

  /** Sets (or replaces) how an invoice is paid in parts. They must add up to its total. */
  async setInstallments(actor: AuthUser, id: string, raw: InstallmentPlanInput): Promise<InvoiceView> {
    this.assertStaff(actor);
    const invoice = await this.get(actor, id);
    if (invoice.status === 'void') throw new BadRequestException('This invoice is void.');
    const plan = raw.installments.length ? this.checkPlan(raw.installments, invoice.total, invoice.issueDate) : [];
    const tenantId = tenantOf(actor);
    await this.db.transaction(async (tx) => {
      const before = await tx.select().from(installments).where(eq(installments.invoiceId, id));
      await tx.delete(installments).where(eq(installments.invoiceId, id));
      if (plan.length) {
        await tx.insert(installments).values(
          plan.map((p, i) => ({
            tenantId,
            invoiceId: id,
            seq: i + 1,
            label: p.label,
            dueDate: p.dueDate,
            amount: p.amount,
            // A late fee already charged for the same installment stays charged.
            lateFeeInvoiceId: before.find((b) => b.seq === i + 1 && b.dueDate === p.dueDate)?.lateFeeInvoiceId ?? null,
          })),
        );
        await tx.update(invoices).set({ dueDate: plan[plan.length - 1]!.dueDate }).where(eq(invoices.id, id));
      }
    });
    await this.audit.record(actor, { action: 'installments.set', entityType: 'invoice', entityId: id, clientId: invoice.clientId, metadata: { number: invoice.number, count: plan.length, plan } });
    return this.get(actor, id);
  }

  /* ---------------------------------------------------------------- */
  /* Credit notes                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Gives back part of an invoice without voiding it - a discount agreed
   * after the fact, a service not delivered. It lowers what the student owes;
   * money already paid beyond that is then refunded separately.
   */
  async creditNote(actor: AuthUser, invoiceId: string, raw: CreditNoteInput): Promise<InvoiceView> {
    this.assertApprover(actor, 'issue a credit note');
    const input = creditNoteSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const invoice = await this.get(actor, invoiceId);
    if (invoice.status !== 'issued') throw new BadRequestException('Credit notes are issued against issued invoices only.');
    const room = invoice.total - invoice.credited;
    if (input.amount > room) {
      throw new BadRequestException({ message: `At most ${formatMoney(room, invoice.currency)} can still be credited on this invoice.`, fieldErrors: { amount: 'More than the invoice' } });
    }
    const issuedOn = input.issuedOn ?? today();
    const taxAmount = invoice.total > 0 ? Math.round((input.amount * invoice.tax) / invoice.total) : 0;
    const note = await withDocumentNumber(this.db, creditNotes, tenantId, 'CN', (number) =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(creditNotes)
          .values({ tenantId, number, invoiceId, clientId: invoice.clientId, amount: input.amount, taxAmount, currency: invoice.currency, reason: input.reason, issuedOn, createdBy: actor.id })
          .returning();
        await postEntry(tx, {
          tenantId,
          date: issuedOn,
          memo: `Credit note ${number} on ${invoice.number}`,
          currency: invoice.currency,
          fxRate: invoice.fxRate,
          sourceType: 'credit_note',
          sourceId: row!.id,
          createdBy: actor.id,
          lines: creditNoteLines(
            input.amount,
            taxAmount,
            invoice.clientId,
            invoice.items.map((i) => ({ category: i.category, amount: i.amount, discount: i.discount, taxAmount: i.tax, taxInclusive: i.taxInclusive })),
          ),
        });
        return row!;
      }),
    );
    await this.audit.record(actor, {
      action: 'credit_note.issued',
      entityType: 'credit_note',
      entityId: note.id,
      clientId: invoice.clientId,
      metadata: { number: note.number, invoice: invoice.number, amount: input.amount, reason: input.reason },
    });
    await this.deliverToClient(tenantId, invoice.clientId, 'invoice_issued', {
      title: `Credit note ${note.number}: ${formatMoney(input.amount, invoice.currency)} off invoice ${invoice.number}`,
      body: input.reason,
      link: `/portal/payments/invoices/${invoiceId}`,
    });
    return this.get(actor, invoiceId);
  }

  async voidCreditNote(actor: AuthUser, id: string, reason: string): Promise<InvoiceView> {
    this.assertApprover(actor, 'void a credit note');
    const tenantId = tenantOf(actor);
    const [cn] = await this.db.select().from(creditNotes).where(and(eq(creditNotes.id, id), eq(creditNotes.tenantId, tenantId))).limit(1);
    if (!cn) throw new NotFoundException('Credit note not found.');
    const invoice = await this.get(actor, cn.invoiceId);
    if (cn.voidedAt) return invoice;
    await this.db.transaction(async (tx) => {
      await tx.update(creditNotes).set({ voidedAt: new Date(), voidedBy: actor.id, voidReason: reason }).where(eq(creditNotes.id, id));
      const entry = await liveEntryFor(tx, tenantId, 'credit_note', id);
      if (entry) await reverseEntry(tx, entry, { date: today(), memo: `Credit note ${cn.number} voided: ${reason}`, sourceType: 'credit_note_void', createdBy: actor.id });
    });
    await this.audit.record(actor, { action: 'credit_note.voided', entityType: 'credit_note', entityId: id, clientId: cn.clientId, metadata: { number: cn.number, invoice: invoice.number, reason } });
    return this.get(actor, cn.invoiceId);
  }

  /* ---------------------------------------------------------------- */
  /* Payments                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Adds a payment or a refund to the ledger. A refund recorded straight
   * away is a manager's call (when the consultancy allows it; otherwise it
   * is requested and approved) and can never exceed what has been paid.
   */
  async record(actor: AuthUser, invoiceId: string, raw: RecordPaymentInput): Promise<InvoiceView> {
    this.assertStaff(actor);
    const input = recordPaymentSchema.parse(raw);
    const tenantId = tenantOf(actor);
    if (input.kind === 'refund') {
      if (actor.role !== 'manager') throw new ForbiddenException('Only a manager can record a refund directly. Request one instead, for approval.');
      const s = await this.settings.row(tenantId);
      if (!s.directRefunds) throw new ForbiddenException('Your consultancy approves every refund. Request it instead.');
    }
    const invoice = await this.get(actor, invoiceId);
    await this.recordInternal(tenantId, invoice, input, actor);
    return this.get(actor, invoiceId);
  }

  /**
   * The ledger write itself, shared by staff recording money, an approved
   * proof of payment, an approved refund and a completed online payment.
   */
  async recordInternal(
    tenantId: string,
    invoice: InvoiceView,
    input: { kind: PaymentKind; amount: number; method: PaymentMethod; reference?: string | null; receivedOn: string; note?: string | null; accountId?: string | null; fxRate?: number | null },
    actor: AuthUser | null,
  ): Promise<typeof payments.$inferSelect> {
    if (invoice.status === 'void') throw new BadRequestException('This invoice is void. Payments cannot be recorded against it.');
    if (invoice.status === 'pending_approval') throw new BadRequestException('This invoice is waiting for approval. Nothing can be paid against it yet.');
    if (input.kind === 'refund' && input.amount > invoice.paid) {
      throw new BadRequestException({
        message: `Only ${formatMoney(invoice.paid, invoice.currency)} has been paid, so that is the most that can be refunded.`,
        fieldErrors: { amount: 'More than has been paid.' },
      });
    }
    if (input.receivedOn > today()) {
      throw new BadRequestException({ message: 'That date is in the future.', fieldErrors: { receivedOn: 'Record money once it has actually moved.' } });
    }
    if (input.accountId) await assertMoneyAccount(this.db, tenantId, input.accountId);
    // Always on record where the money went: the chosen account, or the method's usual one.
    const accountId = input.accountId ?? (await systemAccountId(this.db, tenantId, METHOD_ACCOUNT[input.method]));
    const base = (await this.settings.row(tenantId)).baseCurrency;
    const fxRate = invoice.currency === base ? 1 : (input.fxRate ?? invoice.fxRate ?? null);

    const payment = await withDocumentNumber(this.db, payments, tenantId, input.kind === 'refund' ? 'RFD' : 'RCT', (number) =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(payments)
          .values({
            tenantId,
            number,
            invoiceId: invoice.id,
            clientId: invoice.clientId,
            kind: input.kind,
            amount: input.amount,
            currency: invoice.currency,
            method: input.method,
            reference: input.reference ?? null,
            receivedOn: input.receivedOn,
            note: input.note ?? null,
            accountId,
            fxRate: fxRate === null ? null : String(fxRate),
            recordedBy: actor?.id ?? null,
          })
          .returning();
        await postPayment(
          tx,
          { ...row!, kind: input.kind, method: input.method, fxRate },
          actor?.id ?? null,
        );
        return row!;
      }),
    );

    await this.audit.record(actor, {
      tenantId,
      action: input.kind === 'refund' ? 'refund.recorded' : 'payment.recorded',
      entityType: 'payment',
      entityId: payment.id,
      clientId: invoice.clientId,
      caseId: invoice.caseId,
      metadata: { invoice: invoice.number, receipt: payment.number, amount: input.amount, currency: invoice.currency, method: input.method },
    });

    await this.emitPayment({
      tenantId,
      paymentId: payment.id,
      invoiceId: invoice.id,
      clientId: invoice.clientId,
      kind: input.kind,
      amount: input.amount,
      currency: invoice.currency,
      receivedOn: input.receivedOn,
      fxRate,
      voided: false,
      actor,
    });

    if (input.kind === 'payment') {
      const fresh = await this.view(tenantId, invoice.id);
      const p = fresh.payments.find((x) => x.id === payment.id);
      const attachments = p ? await this.safePdf(() => this.pdf.receipt(tenantId, fresh, p), `${payment.number}.pdf`) : [];
      await this.deliverToClient(tenantId, invoice.clientId, 'payment_received', {
        title: `Payment of ${formatMoney(input.amount, invoice.currency)} received`,
        body: `Receipt ${payment.number} for invoice ${invoice.number}.${fresh.balance > 0 ? ` Still to pay: ${formatMoney(fresh.balance, invoice.currency)}.` : ' The invoice is paid in full.'}`,
        link: '/portal/payments',
        attachments,
      });
    }
    return payment;
  }

  /**
   * Voids a ledger entry. It is not deleted and not edited: it stays on the
   * record, marked void, with who did it and why, and the journal gets a
   * reversing entry - the only honest way to correct money recorded by mistake.
   */
  async voidPayment(actor: AuthUser, paymentId: string, reason: string): Promise<InvoiceView> {
    this.assertApprover(actor, 'void a payment');
    const tenantId = tenantOf(actor);
    const [entry] = await this.db.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.tenantId, tenantId))).limit(1);
    if (!entry) throw new NotFoundException('Payment not found.');
    if (entry.voidedAt) return this.get(actor, entry.invoiceId);

    const invoice = await this.get(actor, entry.invoiceId);
    if (entry.kind === 'payment' && invoice.paid - entry.amount < 0) {
      throw new BadRequestException('Voiding this payment would leave more refunded than paid. Void the refund first.');
    }
    await this.db.transaction(async (tx) => {
      await tx.update(payments).set({ voidedAt: new Date(), voidedBy: actor.id, voidReason: reason }).where(and(eq(payments.id, paymentId), eq(payments.tenantId, tenantId)));
      const je = await liveEntryFor(tx, tenantId, 'payment', paymentId);
      if (je) await reverseEntry(tx, je, { date: today(), memo: `${entry.kind === 'refund' ? 'Refund' : 'Payment'} ${entry.number} voided: ${reason}`, sourceType: 'payment_void', createdBy: actor.id });
    });
    await this.audit.record(actor, { action: 'payment.voided', entityType: 'payment', entityId: paymentId, clientId: entry.clientId, metadata: { receipt: entry.number, amount: entry.amount, reason } });
    await this.emitPayment({
      tenantId,
      paymentId,
      invoiceId: entry.invoiceId,
      clientId: entry.clientId,
      kind: entry.kind as PaymentKind,
      amount: entry.amount,
      currency: entry.currency,
      receivedOn: entry.receivedOn,
      fxRate: entry.fxRate === null ? null : Number(entry.fxRate),
      voided: true,
      actor,
    });
    return this.get(actor, entry.invoiceId);
  }

  /** Ledger entries, newest first, within the actor's scope. */
  async ledger(actor: AuthUser, filter: { invoiceId?: string; clientId?: string; limit?: number }): Promise<PaymentView[]> {
    return this.ledgerRows(
      and(
        this.scope(actor),
        filter.invoiceId ? eq(payments.invoiceId, filter.invoiceId) : undefined,
        filter.clientId ? eq(payments.clientId, filter.clientId) : undefined,
      ),
      filter.limit,
    );
  }

  private async ledgerRows(where: SQL | undefined, limit = 200): Promise<PaymentView[]> {
    const recorder = alias(users, 'recorder');
    const voider = alias(users, 'voider');
    const rows = await this.db
      .select({
        p: payments,
        invoiceNumber: invoices.number,
        clientName: clients.fullName,
        recordedByName: recorder.fullName,
        voidedByName: voider.fullName,
        accountName: ledgerAccounts.name,
      })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .leftJoin(recorder, eq(recorder.id, payments.recordedBy))
      .leftJoin(voider, eq(voider.id, payments.voidedBy))
      .leftJoin(ledgerAccounts, eq(ledgerAccounts.id, payments.accountId))
      .where(where)
      .orderBy(desc(payments.receivedOn), desc(payments.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.p.id,
      number: r.p.number,
      invoiceId: r.p.invoiceId,
      invoiceNumber: r.invoiceNumber,
      clientName: r.clientName,
      kind: r.p.kind as PaymentKind,
      amount: r.p.amount,
      currency: r.p.currency as Currency,
      method: r.p.method as PaymentMethod,
      reference: r.p.reference,
      receivedOn: r.p.receivedOn,
      note: r.p.note,
      recordedByName: r.recordedByName,
      createdAt: iso(r.p.createdAt),
      voided: Boolean(r.p.voidedAt),
      voidReason: r.p.voidReason,
      voidedAt: isoOrNull(r.p.voidedAt),
      voidedByName: r.voidedByName,
      accountName: r.accountName,
    }));
  }

  /** One receipt, for printing. */
  async receipt(actor: AuthUser, paymentId: string) {
    const [p] = await this.db
      .select({ invoiceId: payments.invoiceId })
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.tenantId, tenantOf(actor))))
      .limit(1);
    if (!p) throw new NotFoundException('Receipt not found.');
    // Through get(), so the role scope applies exactly as it does to the invoice.
    const invoice = await this.get(actor, p.invoiceId);
    const payment = invoice.payments.find((x) => x.id === paymentId);
    if (!payment) throw new NotFoundException('Receipt not found.');
    return { invoice, payment };
  }

  /* ---------------------------------------------------------------- */
  /* Documents out: PDFs, emails, statements                           */
  /* ---------------------------------------------------------------- */

  async invoicePdf(actor: AuthUser, id: string): Promise<{ file: Buffer; name: string }> {
    const inv = await this.get(actor, id);
    return { file: await this.pdf.invoice(tenantOf(actor), inv), name: `${inv.number}.pdf` };
  }

  async receiptPdf(actor: AuthUser, paymentId: string): Promise<{ file: Buffer; name: string }> {
    const { invoice, payment } = await this.receipt(actor, paymentId);
    return { file: await this.pdf.receipt(tenantOf(actor), invoice, payment), name: `${payment.number}.pdf` };
  }

  /** Sends the invoice (with its PDF) to the student's email address, again. */
  async emailInvoice(actor: AuthUser, id: string): Promise<{ sentTo: string }> {
    this.assertStaff(actor);
    const inv = await this.get(actor, id);
    if (inv.status !== 'issued') throw new BadRequestException('Only an issued invoice can be sent.');
    if (!inv.clientEmail) throw new BadRequestException('This student has no email address on file.');
    const tenantId = tenantOf(actor);
    const site = await tenantIdentity(this.db, tenantId);
    const attachments = await this.safePdf(() => this.pdf.invoice(tenantId, inv), `${inv.number}.pdf`);
    const text = invoiceEmailText(inv, site.name, `${site.origin}/portal/payments/invoices/${inv.id}`);
    const ok = await this.mail.send({
      to: inv.clientEmail,
      subject: `Invoice ${inv.number} from ${site.name}`,
      text,
      html: textToHtml(text),
      fromName: site.name,
      replyTo: site.contactEmail ?? undefined,
      attachments,
    });
    if (!ok) throw new BadRequestException('The email could not be sent. Check the mail settings and try again.');
    await this.audit.record(actor, { action: 'invoice.sent', entityType: 'invoice', entityId: id, clientId: inv.clientId, metadata: { number: inv.number, to: inv.clientEmail } });
    return { sentTo: inv.clientEmail };
  }

  /**
   * A student's account: every invoice, credit note, payment and refund in
   * one currency, with the balance carried through.
   */
  async statement(actor: AuthUser, clientId: string, q: { currency?: string; from?: string; to?: string } = {}): Promise<StatementView> {
    const tenantId = tenantOf(actor);
    if (actor.role === 'client' && actor.clientId !== clientId) throw new NotFoundException('Client not found.');
    const client =
      actor.role === 'client'
        ? (await this.db.select({ id: clients.id, fullName: clients.fullName }).from(clients).where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId))).limit(1))[0]
        : await this.billableClient(actor, clientId);
    if (!client) throw new NotFoundException('Client not found.');

    const live = and(eq(invoices.tenantId, tenantId), eq(invoices.clientId, clientId), eq(invoices.status, 'issued'));
    const [invRows, payRows, cnRows] = await Promise.all([
      this.db.select({ id: invoices.id, number: invoices.number, date: invoices.issueDate, currency: invoices.currency, total: invoices.total }).from(invoices).where(live),
      this.db
        .select({ id: payments.id, number: payments.number, date: payments.receivedOn, kind: payments.kind, currency: payments.currency, amount: payments.amount, invoiceNumber: invoices.number, method: payments.method })
        .from(payments)
        .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
        .where(and(eq(payments.tenantId, tenantId), eq(payments.clientId, clientId), isNull(payments.voidedAt))),
      this.db
        .select({ id: creditNotes.id, number: creditNotes.number, date: creditNotes.issuedOn, currency: creditNotes.currency, amount: creditNotes.amount, invoiceId: creditNotes.invoiceId, reason: creditNotes.reason })
        .from(creditNotes)
        .where(and(eq(creditNotes.tenantId, tenantId), eq(creditNotes.clientId, clientId), isNull(creditNotes.voidedAt))),
    ]);
    const currencies = [...new Set([...invRows.map((r) => r.currency), ...payRows.map((r) => r.currency)])] as Currency[];
    const currency = (q.currency && currencies.includes(q.currency as Currency) ? q.currency : (currencies[0] ?? 'PKR')) as Currency;
    const portal = actor.role === 'client';
    const events: Omit<StatementLine, 'balance'>[] = [
      ...invRows.filter((r) => r.currency === currency).map((r) => ({
        date: r.date,
        kind: 'invoice' as const,
        reference: r.number,
        description: 'Invoice',
        debit: r.total,
        credit: 0,
        link: portal ? `/portal/payments/invoices/${r.id}` : null,
      })),
      ...cnRows.filter((r) => r.currency === currency).map((r) => ({
        date: r.date,
        kind: 'credit_note' as const,
        reference: r.number,
        description: `Credit note: ${r.reason}`,
        debit: 0,
        credit: r.amount,
        link: null,
      })),
      ...payRows.filter((r) => r.currency === currency).map((r) => ({
        date: r.date,
        kind: (r.kind === 'refund' ? 'refund' : 'payment') as 'refund' | 'payment',
        reference: r.number,
        description: `${r.kind === 'refund' ? 'Refund' : 'Payment'} for ${r.invoiceNumber}`,
        debit: r.kind === 'refund' ? r.amount : 0,
        credit: r.kind === 'refund' ? 0 : r.amount,
        link: portal ? `/portal/payments/receipts/${r.id}` : null,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'invoice' ? -1 : 1));
    const to = q.to ?? today();
    let opening = 0;
    let balance = 0;
    const lines: StatementLine[] = [];
    for (const e of events) {
      if (e.date > to) continue;
      balance += e.debit - e.credit;
      if (q.from && e.date < q.from) {
        opening = balance;
        continue;
      }
      lines.push({ ...e, balance });
    }
    return { clientId, clientName: client.fullName, currency, currencies: currencies.length ? currencies : [currency], from: q.from ?? null, to, opening, closing: balance, lines };
  }

  async statementPdf(actor: AuthUser, clientId: string, q: { currency?: string; from?: string; to?: string }) {
    const s = await this.statement(actor, clientId, q);
    return { file: await this.pdf.statement(tenantOf(actor), s), name: `Statement ${s.clientName} ${s.currency}.pdf` };
  }

  /** Tells the student an invoice is issued - in the app, and by email with the PDF. */
  async announceInvoice(tenantId: string, invoiceId: string): Promise<void> {
    try {
      const inv = await this.view(tenantId, invoiceId);
      const attachments = await this.safePdf(() => this.pdf.invoice(tenantId, inv), `${inv.number}.pdf`);
      await this.deliverToClient(tenantId, inv.clientId, 'invoice_issued', {
        title: `Invoice ${inv.number} for ${formatMoney(inv.total, inv.currency)}`,
        body: inv.installments.length
          ? `Payable in ${inv.installments.length} parts; the first, ${formatMoney(inv.installments[0]!.amount, inv.currency)}, is due ${inv.installments[0]!.dueDate}.`
          : `Due by ${inv.dueDate}.`,
        link: `/portal/payments/invoices/${inv.id}`,
        attachments,
      });
    } catch (err) {
      this.logger.error(`invoice ${invoiceId} not announced`, err as Error);
    }
  }

  /**
   * To the student: in the app and by email when they have a portal login;
   * by email alone (to the address on their record) when they do not.
   */
  async deliverToClient(
    tenantId: string,
    clientId: string,
    type: NotificationType,
    msg: { title: string; body: string; link: string; attachments?: MailAttachment[] },
  ): Promise<void> {
    const [c] = await this.db
      .select({ userId: clients.userId, email: clients.email, name: clients.fullName, emails: tenants.emailNotifications })
      .from(clients)
      .innerJoin(tenants, eq(tenants.id, clients.tenantId))
      .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)))
      .limit(1);
    if (!c) return;
    if (c.userId) {
      await this.notifications.push({ userId: c.userId, type, title: msg.title, body: msg.body, link: msg.link, email: true, attachments: msg.attachments });
      return;
    }
    if (!c.email || c.emails?.[type] === false) return;
    const site = await tenantIdentity(this.db, tenantId);
    const text = [`Hello ${c.name.split(' ')[0]},`, `${msg.title}\n${msg.body}`, `${site.name}${site.contactPhone ? ` · ${site.contactPhone}` : ''}`].join('\n\n');
    await this.mail.send({ to: c.email, subject: msg.title, text, html: textToHtml(text), fromName: site.name, replyTo: site.contactEmail ?? undefined, attachments: msg.attachments });
  }

  /** A PDF to attach - or none, if rendering fails (the email still goes). */
  private async safePdf(make: () => Promise<Buffer>, filename: string): Promise<MailAttachment[]> {
    try {
      return [{ filename, content: await make(), contentType: 'application/pdf' }];
    } catch (err) {
      this.logger.error(`PDF ${filename} failed`, err as Error);
      return [];
    }
  }

  /* ---------------------------------------------------------------- */
  /* Totals                                                            */
  /* ---------------------------------------------------------------- */

  /** Invoiced, collected and outstanding, per currency, for everything in scope. */
  async totals(actor: AuthUser, clientId?: string): Promise<BillingTotals[]> {
    const day = today();
    const tenantId = tenantOf(actor);
    const where = and(this.scope(actor), clientId ? eq(invoices.clientId, clientId) : undefined);
    // What each invoice has been paid and credited, and what of its plan has
    // fallen due, aggregated in one pass each and joined in.
    const paidByInvoice = this.db
      .select({
        invoiceId: payments.invoiceId,
        paid: sql<number>`sum(case when ${payments.kind} = 'payment' then ${payments.amount} else -${payments.amount} end)`.as('paid'),
      })
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), isNull(payments.voidedAt)))
      .groupBy(payments.invoiceId)
      .as('paid_by_invoice');
    const creditedByInvoice = this.db
      .select({ invoiceId: creditNotes.invoiceId, credited: sql<number>`sum(${creditNotes.amount})`.as('credited') })
      .from(creditNotes)
      .where(and(eq(creditNotes.tenantId, tenantId), isNull(creditNotes.voidedAt)))
      .groupBy(creditNotes.invoiceId)
      .as('credited_by_invoice');
    const dueByInvoice = this.db
      .select({
        invoiceId: installments.invoiceId,
        due: sql<number>`sum(${installments.amount}) filter (where ${installments.dueDate} < ${day})`.as('due'),
      })
      .from(installments)
      .where(eq(installments.tenantId, tenantId))
      .groupBy(installments.invoiceId)
      .as('due_by_invoice');
    const paid = sql`coalesce(${paidByInvoice.paid}, 0)::bigint`;
    const settled = sql`(${paid} + coalesce(${creditedByInvoice.credited}, 0))`;
    const balance = sql`greatest(${invoices.total} - ${settled}, 0)`;
    const overdue = sql`case when ${dueByInvoice.invoiceId} is not null
      then greatest(least(coalesce(${dueByInvoice.due}, 0) - ${settled}, ${balance}), 0)
      else case when ${invoices.dueDate} < ${day} then ${balance} else 0 end end`;
    const live = sql`${invoices.status} = 'issued'`;

    const since = localIsoDateIn(-30);
    const [rows, recent] = await Promise.all([
      this.db
        .select({
          currency: invoices.currency,
          invoiced: sql<number>`coalesce(sum(${invoices.total}) filter (where ${live}), 0)::bigint`,
          collected: sql<number>`coalesce(sum(${paid}) filter (where ${live}), 0)::bigint`,
          outstanding: sql<number>`coalesce(sum(${balance}) filter (where ${live}), 0)::bigint`,
          overdue: sql<number>`coalesce(sum(${overdue}) filter (where ${live}), 0)::bigint`,
        })
        .from(invoices)
        .innerJoin(clients, eq(clients.id, invoices.clientId))
        .leftJoin(paidByInvoice, eq(paidByInvoice.invoiceId, invoices.id))
        .leftJoin(creditedByInvoice, eq(creditedByInvoice.invoiceId, invoices.id))
        .leftJoin(dueByInvoice, eq(dueByInvoice.invoiceId, invoices.id))
        .where(where)
        .groupBy(invoices.currency),
      this.db
        .select({
          currency: payments.currency,
          n: sql<number>`coalesce(sum(case when ${payments.kind} = 'payment' then ${payments.amount} else -${payments.amount} end), 0)::bigint`,
        })
        .from(payments)
        .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
        .innerJoin(clients, eq(clients.id, invoices.clientId))
        .where(and(where, isNull(payments.voidedAt), sql`${payments.receivedOn} >= ${since}`))
        .groupBy(payments.currency),
    ]);
    const recentBy = new Map(recent.map((r) => [r.currency, Number(r.n)]));
    return rows
      .map((r) => ({
        currency: r.currency as Currency,
        invoiced: Number(r.invoiced),
        collected: Number(r.collected),
        outstanding: Number(r.outstanding),
        overdue: Number(r.overdue),
        collected30: recentBy.get(r.currency) ?? 0,
      }))
      .sort((a, b) => b.invoiced - a.invoiced);
  }

  /** Money collected per month, in the consultancy's main currency. */
  async revenue(actor: AuthUser, months: number) {
    const span = Math.min(24, Math.max(3, months));
    const since = addCalendarMonths(`${localIsoDate().slice(0, 7)}-01`, -(span - 1));

    // The currency with the most invoiced - the first row totals() would put
    // on top - without computing every other total just to read one name.
    const invoiced = sql`coalesce(sum(${invoices.total}) filter (where ${invoices.status} = 'issued'), 0)`;
    const [top] = await this.db
      .select({ currency: invoices.currency })
      .from(invoices)
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(this.scope(actor))
      .groupBy(invoices.currency)
      .orderBy(desc(invoiced))
      .limit(1);
    const main = top?.currency ?? 'PKR';
    const rows = await this.db
      .select({
        period: sql<string>`to_char(${payments.receivedOn}, 'YYYY-MM')`,
        n: sql<number>`coalesce(sum(case when ${payments.kind} = 'payment' then ${payments.amount} else -${payments.amount} end), 0)::bigint`,
      })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(and(this.scope(actor), isNull(payments.voidedAt), eq(payments.currency, main), sql`${payments.receivedOn} >= ${since}`))
      .groupBy(sql`to_char(${payments.receivedOn}, 'YYYY-MM')`);
    const byPeriod = new Map(rows.map((r) => [r.period, Number(r.n)]));

    const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const points = [];
    for (let i = 0; i < span; i++) {
      const period = addCalendarMonths(since, i).slice(0, 7);
      points.push({ period, label: MONTH[Number(period.slice(5, 7)) - 1]!, collected: byPeriod.get(period) ?? 0 });
    }
    return { currency: main, points };
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  private summarySelection(day: string) {
    return {
      id: invoices.id,
      number: invoices.number,
      clientId: invoices.clientId,
      clientName: clients.fullName,
      caseId: invoices.caseId,
      caseReference: cases.reference,
      currency: invoices.currency,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      status: invoices.status,
      total: invoices.total,
      paid: paidSql,
      credited: creditedSql,
      overdue: sql<boolean>`${overdueSql(day)}`,
    };
  }

  /** Installments of several invoices at once, by invoice. */
  private async plansFor(ids: string[]): Promise<Map<string, (typeof installments.$inferSelect)[]>> {
    const map = new Map<string, (typeof installments.$inferSelect)[]>();
    if (!ids.length) return map;
    const rows = await this.db.select().from(installments).where(inArray(installments.invoiceId, ids)).orderBy(asc(installments.seq));
    for (const r of rows) map.set(r.invoiceId, [...(map.get(r.invoiceId) ?? []), r]);
    return map;
  }
}

interface SummaryRow {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  caseId: string | null;
  caseReference: string | null;
  currency: string;
  issueDate: string;
  dueDate: string;
  status: string;
  total: number;
  paid: number | string;
  credited: number | string;
  overdue: boolean | string;
}

function toSummary(r: SummaryRow, plan: { dueDate: string; amount: number }[] | undefined, day: string): InvoiceSummaryView {
  const paid = Number(r.paid);
  const credited = Number(r.credited);
  const total = Number(r.total);
  const status = r.status as InvoiceStatus;
  const balance = status === 'issued' ? total - credited - paid : status === 'pending_approval' ? total : 0;
  let nextDue: InvoiceSummaryView['nextDue'] = null;
  if (plan?.length && status === 'issued') {
    const next = allocateInstallments(plan, paid + credited, day).find((p) => p.status !== 'paid');
    if (next) nextDue = { dueDate: next.dueDate, amount: next.amount - next.paid };
  }
  return {
    id: r.id,
    number: r.number,
    clientId: r.clientId,
    clientName: r.clientName,
    caseId: r.caseId,
    caseReference: r.caseReference,
    currency: r.currency as Currency,
    issueDate: r.issueDate,
    dueDate: r.dueDate,
    status,
    paymentStatus: paymentStatus(total - credited, paid, status),
    total,
    paid,
    credited,
    balance,
    overdue: r.overdue === true || r.overdue === 't',
    nextDue,
  };
}

function toPackage(p: typeof servicePackages.$inferSelect): ServicePackageView {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    amount: p.amount,
    currency: p.currency as Currency,
    active: p.active,
    category: p.category as FeeCategory,
    taxRateId: p.taxRateId,
  };
}

function invoiceEmailText(inv: InvoiceView, agency: string, link: string): string {
  return [
    `Hello ${inv.clientName.split(' ')[0]},`,
    `Please find invoice ${inv.number} for ${formatMoney(inv.total, inv.currency)} attached.`,
    inv.installments.length
      ? `It is payable in ${inv.installments.length} parts:\n${inv.installments.map((i) => `- ${i.dueDate}: ${formatMoney(i.amount, inv.currency)}`).join('\n')}`
      : `It is due by ${inv.dueDate}.`,
    inv.balance < inv.total ? `Still to pay: ${formatMoney(Math.max(0, inv.balance), inv.currency)}.` : '',
    `You can view it, pay online where available, or upload proof of a transfer here: ${link}`,
    agency,
  ]
    .filter(Boolean)
    .join('\n\n');
}
