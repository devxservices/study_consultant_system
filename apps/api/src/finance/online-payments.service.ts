import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import {
  formatMoney,
  startOnlinePaymentSchema,
  type AuthUser,
  type Currency,
  type GatewayProvider,
  type OnlinePaymentStatus,
  type OnlinePaymentView,
  type StartOnlinePaymentInput,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { clients, invoices, onlinePayments, payments } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { tenantIdentity } from '../tenancy/tenant-links';
import { seesAll } from '../auth/permissions';
import { NIL_UUID, iso, isoOrNull, today } from '../common/db-helpers';
import { permissionHolders } from '../common/permission-holders';
import { isProd } from '../config/env';
import { BillingService } from '../billing/billing.service';
import { FinanceSettingsService } from './finance-settings.service';
import { stripeCheckout, verifyStripeSignature, type StripeEvent } from './gateways';

/** A checkout nobody finished within a day is treated as abandoned. */
const EXPIRES_MS = 24 * 60 * 60 * 1000;

/**
 * Paying an invoice online. The student starts a checkout for the next
 * installment or the whole balance; money is recorded only when the
 * provider confirms it (a signed webhook), once, however many times the
 * confirmation arrives.
 */
@Injectable()
export class OnlinePaymentsService {
  private readonly logger = new Logger(OnlinePaymentsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly billing: BillingService,
    private readonly settings: FinanceSettingsService,
  ) {}

  async start(actor: AuthUser, invoiceId: string, raw: StartOnlinePaymentInput): Promise<OnlinePaymentView> {
    if (actor.role !== 'client') throw new ForbiddenException('Online payment is for students paying their own invoices.');
    const input = startOnlinePaymentSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const gateway = await this.settings.gatewayFor(tenantId);
    if (gateway.provider === 'none') {
      throw new BadRequestException('Online payment is not switched on. Pay by transfer and upload the proof instead.');
    }
    if (gateway.provider === 'test' && isProd()) throw new BadRequestException('Online payment is not available right now.');
    const invoice = await this.billing.get(actor, invoiceId);
    if (invoice.status !== 'issued' || invoice.balance <= 0) throw new BadRequestException('Nothing is owed on this invoice.');
    const amount = input.what === 'next' && invoice.nextDue ? Math.min(invoice.nextDue.amount, invoice.balance) : invoice.balance;

    const [row] = await this.db
      .insert(onlinePayments)
      .values({ tenantId, invoiceId, clientId: invoice.clientId, amount, currency: invoice.currency, provider: gateway.provider, startedBy: actor.id })
      .returning();
    const site = await tenantIdentity(this.db, tenantId);
    const back = `${site.origin}/portal/payments/invoices/${invoiceId}`;
    try {
      let providerRef: string;
      let url: string;
      if (gateway.provider === 'stripe') {
        if (!gateway.stripeSecretKey) throw new BadRequestException('Online payment is not set up yet.');
        const session = await stripeCheckout(gateway.stripeSecretKey, {
          amount,
          currency: invoice.currency,
          description: `${site.name} - invoice ${invoice.number}`,
          successUrl: `${back}?paid=${row!.id}`,
          cancelUrl: `${back}?cancelled=${row!.id}`,
          reference: row!.id,
          customerEmail: invoice.clientEmail,
        });
        providerRef = session.providerRef;
        url = session.url;
      } else {
        providerRef = `test_${row!.id}`;
        url = `${site.origin}/pay/test/${row!.id}`;
      }
      await this.db.update(onlinePayments).set({ providerRef, url }).where(eq(onlinePayments.id, row!.id));
    } catch (err) {
      await this.db.update(onlinePayments).set({ status: 'failed' }).where(eq(onlinePayments.id, row!.id));
      this.logger.error(`checkout for ${invoice.number} failed`, err as Error);
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('The payment page could not be opened. Please try again, or pay by transfer.');
    }
    return this.get(actor, row!.id);
  }

  async get(actor: AuthUser, id: string): Promise<OnlinePaymentView> {
    const rows = await this.rows(and(eq(onlinePayments.id, id), this.scope(actor)), 1);
    if (!rows[0]) throw new NotFoundException('Payment not found.');
    return rows[0];
  }

  async list(actor: AuthUser, invoiceId?: string): Promise<OnlinePaymentView[]> {
    return this.rows(and(this.scope(actor), invoiceId ? eq(onlinePayments.invoiceId, invoiceId) : undefined), 100);
  }

  private scope(actor: AuthUser): SQL | undefined {
    const tenant = eq(onlinePayments.tenantId, tenantOf(actor));
    if (actor.role === 'client') return and(tenant, eq(onlinePayments.clientId, actor.clientId ?? NIL_UUID));
    if (actor.role === 'manager' || seesAll(actor)) return tenant;
    if (actor.role === 'consultant') return and(tenant, eq(clients.assignedConsultantId, actor.consultantId ?? NIL_UUID));
    return sql`false`;
  }

  private async rows(where: SQL | undefined, limit: number): Promise<OnlinePaymentView[]> {
    const rows = await this.db
      .select({ o: onlinePayments, invoiceNumber: invoices.number, clientName: clients.fullName, receiptNumber: payments.number })
      .from(onlinePayments)
      .innerJoin(invoices, eq(invoices.id, onlinePayments.invoiceId))
      .innerJoin(clients, eq(clients.id, onlinePayments.clientId))
      .leftJoin(payments, eq(payments.id, onlinePayments.paymentId))
      .where(where)
      .orderBy(desc(onlinePayments.createdAt))
      .limit(limit);
    const now = Date.now();
    return rows.map((r) => ({
      id: r.o.id,
      invoiceId: r.o.invoiceId,
      invoiceNumber: r.invoiceNumber,
      clientName: r.clientName,
      amount: r.o.amount,
      currency: r.o.currency as Currency,
      provider: r.o.provider as GatewayProvider,
      status: (r.o.status === 'created' && now - r.o.createdAt.getTime() > EXPIRES_MS ? 'expired' : r.o.status) as OnlinePaymentStatus,
      url: r.o.status === 'created' ? r.o.url : null,
      paymentId: r.o.paymentId,
      receiptNumber: r.receiptNumber,
      createdAt: iso(r.o.createdAt),
      completedAt: isoOrNull(r.o.completedAt),
    }));
  }

  /**
   * The provider says it is paid. Claimed with a conditional update, so a
   * webhook delivered twice (or a webhook racing the test page) records the
   * money once. If the invoice can no longer take it - voided meanwhile -
   * the money is still marked received and the managers are told to refund it.
   */
  async complete(tenantId: string, id: string, amountReceived: number | null): Promise<void> {
    const [claimed] = await this.db
      .update(onlinePayments)
      .set({ status: 'paid', completedAt: new Date() })
      .where(and(eq(onlinePayments.id, id), eq(onlinePayments.tenantId, tenantId), eq(onlinePayments.status, 'created')))
      .returning();
    if (!claimed) return;
    const amount = amountReceived ?? claimed.amount;
    try {
      const invoice = await this.billing.view(tenantId, claimed.invoiceId);
      const payment = await this.billing.recordInternal(
        tenantId,
        invoice,
        {
          kind: 'payment',
          amount,
          method: claimed.provider === 'stripe' ? 'card' : 'online',
          reference: claimed.providerRef,
          receivedOn: today(),
          note: `Paid online (${claimed.provider === 'stripe' ? 'Stripe' : 'test mode'})`,
          accountId: null,
        },
        null,
      );
      await this.db.update(onlinePayments).set({ paymentId: payment.id }).where(eq(onlinePayments.id, id));
      await this.audit.record(null, {
        tenantId,
        action: 'online_payment.received',
        entityType: 'online_payment',
        entityId: id,
        clientId: claimed.clientId,
        metadata: { invoice: invoice.number, receipt: payment.number, amount, provider: claimed.provider, ref: claimed.providerRef },
      });
    } catch (err) {
      this.logger.error(`online payment ${id} received but not recorded`, err as Error);
      const managers = await permissionHolders(this.db, tenantId, 'billing.approve');
      await this.notifications.pushMany(managers, {
        type: 'approval_needed',
        title: `An online payment of ${formatMoney(amount, claimed.currency)} could not be recorded`,
        body: `${(err as Error).message} The money was taken by ${claimed.provider}; record it by hand or refund it there.`,
        link: `/overview/finance/invoices/${claimed.invoiceId}`,
        email: true,
      });
    }
  }

  /** The simulated provider's Pay / Cancel buttons. */
  async testDecision(actor: AuthUser, id: string, pay: boolean): Promise<OnlinePaymentView> {
    if (isProd()) throw new ForbiddenException('Test payments are switched off on a live server.');
    const op = await this.get(actor, id);
    if (op.provider !== 'test') throw new BadRequestException('This is not a test payment.');
    if (op.status !== 'created') throw new BadRequestException('This payment is already finished.');
    if (pay) await this.complete(tenantOf(actor), id, null);
    else await this.db.update(onlinePayments).set({ status: 'cancelled', completedAt: new Date() }).where(and(eq(onlinePayments.id, id), eq(onlinePayments.status, 'created')));
    return this.get(actor, id);
  }

  /** Stripe's word that a checkout finished. Anything unsigned or for someone else is refused. */
  async stripeWebhook(tenantId: string, rawBody: Buffer | undefined, signature: string | undefined): Promise<{ received: true }> {
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new NotFoundException();
    const gateway = await this.settings.gatewayFor(tenantId).catch(() => null);
    if (!gateway?.stripeWebhookSecret || !rawBody) throw new UnauthorizedException('Not configured.');
    if (!verifyStripeSignature(rawBody, signature, gateway.stripeWebhookSecret)) throw new UnauthorizedException('Bad signature.');
    const event = JSON.parse(rawBody.toString('utf8')) as StripeEvent;
    const session = event.data?.object;
    if (!session?.id) return { received: true };
    const [op] = await this.db
      .select()
      .from(onlinePayments)
      .where(and(eq(onlinePayments.tenantId, tenantId), eq(onlinePayments.provider, 'stripe'), eq(onlinePayments.providerRef, session.id)))
      .limit(1);
    if (!op) return { received: true };
    if (event.type === 'checkout.session.completed' && session.payment_status === 'paid') {
      await this.complete(tenantId, op.id, typeof session.amount_total === 'number' ? session.amount_total : null);
    } else if (event.type === 'checkout.session.expired') {
      await this.db.update(onlinePayments).set({ status: 'cancelled', completedAt: new Date() }).where(and(eq(onlinePayments.id, op.id), eq(onlinePayments.status, 'created')));
    }
    return { received: true };
  }
}
