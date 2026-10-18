import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import {
  decideSchema,
  formatMoney,
  refundRequestSchema,
  type AuthUser,
  type DecideInput,
  type PaymentMethod,
  type RefundRequestInput,
  type RefundRequestView,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { clients, refundRequests } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { seesAll, staffCan } from '../auth/permissions';
import { NIL_UUID, today } from '../common/db-helpers';
import { permissionHolders } from '../common/permission-holders';
import { BillingService } from '../billing/billing.service';
import { assertMoneyAccount } from './journal';
import { refundRequestRows } from './views';

/**
 * Refunds with a second pair of eyes: someone with "Request refunds" asks,
 * with a reason; someone with "Approve refunds and discounts" - never the
 * person who asked - approves, and only then is money recorded going out.
 */
@Injectable()
export class RefundsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly billing: BillingService,
  ) {}

  private scope(actor: AuthUser): SQL | undefined {
    const tenant = eq(refundRequests.tenantId, tenantOf(actor));
    if (actor.role === 'manager' || seesAll(actor)) return tenant;
    if (actor.role === 'consultant') return and(tenant, eq(clients.assignedConsultantId, actor.consultantId ?? NIL_UUID));
    return sql`false`;
  }

  async list(actor: AuthUser, status?: string): Promise<RefundRequestView[]> {
    if (!staffCan(actor, 'billing.refund') && !staffCan(actor, 'billing.approve')) {
      throw new ForbiddenException('You do not have permission to see refunds.');
    }
    // The scope joins clients; the shared row query joins it too.
    return refundRequestRows(this.db, and(this.scope(actor), status && status !== 'all' ? eq(refundRequests.status, status) : undefined));
  }

  async request(actor: AuthUser, invoiceId: string, raw: RefundRequestInput): Promise<RefundRequestView> {
    if (!staffCan(actor, 'billing.refund')) throw new ForbiddenException('You do not have permission to request refunds.');
    const input = refundRequestSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const invoice = await this.billing.get(actor, invoiceId);
    if (invoice.status !== 'issued') throw new BadRequestException('Refunds are against issued invoices.');
    const [waiting] = await this.db
      .select({ n: sql<number>`coalesce(sum(${refundRequests.amount}), 0)::bigint` })
      .from(refundRequests)
      .where(and(eq(refundRequests.invoiceId, invoiceId), eq(refundRequests.status, 'pending')));
    const room = invoice.paid - Number(waiting?.n ?? 0);
    if (input.amount > room) {
      throw new BadRequestException({
        message: `At most ${formatMoney(Math.max(0, room), invoice.currency)} can be refunded (what was paid, less refunds already waiting).`,
        fieldErrors: { amount: 'More than was paid' },
      });
    }
    if (input.accountId) await assertMoneyAccount(this.db, tenantId, input.accountId);
    const [row] = await this.db
      .insert(refundRequests)
      .values({
        tenantId,
        invoiceId,
        clientId: invoice.clientId,
        amount: input.amount,
        currency: invoice.currency,
        method: input.method,
        accountId: input.accountId ?? null,
        reason: input.reason,
        requestedBy: actor.id,
      })
      .returning();
    await this.audit.record(actor, {
      action: 'refund.requested',
      entityType: 'refund_request',
      entityId: row!.id,
      clientId: invoice.clientId,
      metadata: { invoice: invoice.number, amount: input.amount, currency: invoice.currency, reason: input.reason },
    });
    const approvers = await permissionHolders(this.db, tenantId, 'billing.approve', { exclude: actor.id });
    await this.notifications.pushMany(approvers, {
      type: 'refund_requested',
      title: `Refund of ${formatMoney(input.amount, invoice.currency)} to approve`,
      body: `${invoice.clientName}, invoice ${invoice.number}: ${input.reason}`,
      link: '/overview/finance/approvals',
      email: true,
    });
    return (await refundRequestRows(this.db, eq(refundRequests.id, row!.id), 1))[0]!;
  }

  async decide(actor: AuthUser, id: string, raw: DecideInput): Promise<RefundRequestView> {
    if (!this.billing.canApprove(actor)) throw new ForbiddenException('You need “Approve refunds and discounts” to decide refunds.');
    const input = decideSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const [r] = await this.db
      .select({ r: refundRequests })
      .from(refundRequests)
      .innerJoin(clients, eq(clients.id, refundRequests.clientId))
      .where(and(eq(refundRequests.id, id), this.scope(actor)))
      .limit(1);
    if (!r) throw new NotFoundException('Refund request not found.');
    if (r.r.requestedBy === actor.id) throw new ForbiddenException('Someone else has to approve a refund you asked for.');
    const [claimed] = await this.db
      .update(refundRequests)
      .set({ status: input.approve ? 'approving' : 'rejected', decidedBy: actor.id, decidedAt: new Date(), decisionNote: input.note })
      .where(and(eq(refundRequests.id, id), eq(refundRequests.status, 'pending')))
      .returning({ id: refundRequests.id });
    if (!claimed) throw new BadRequestException('This request has already been decided.');

    let paymentNumber: string | null = null;
    if (input.approve) {
      try {
        const invoice = await this.billing.view(tenantId, r.r.invoiceId);
        const payment = await this.billing.recordInternal(
          tenantId,
          invoice,
          { kind: 'refund', amount: r.r.amount, method: r.r.method as PaymentMethod, receivedOn: today(), note: r.r.reason, accountId: r.r.accountId, reference: null },
          actor,
        );
        paymentNumber = payment.number;
        await this.db.update(refundRequests).set({ status: 'approved', paymentId: payment.id }).where(eq(refundRequests.id, id));
      } catch (err) {
        await this.db.update(refundRequests).set({ status: 'pending', decidedBy: null, decidedAt: null, decisionNote: null }).where(eq(refundRequests.id, id));
        throw err;
      }
    }
    await this.audit.record(actor, {
      action: input.approve ? 'refund.approved' : 'refund.rejected',
      entityType: 'refund_request',
      entityId: id,
      clientId: r.r.clientId,
      metadata: { amount: r.r.amount, currency: r.r.currency, note: input.note, receipt: paymentNumber },
    });
    if (r.r.requestedBy) {
      await this.notifications.push({
        userId: r.r.requestedBy,
        type: 'refund_decided',
        title: `Refund of ${formatMoney(r.r.amount, r.r.currency)} ${input.approve ? 'approved' : 'turned down'}`,
        body: input.note ?? (input.approve ? `Recorded as ${paymentNumber}.` : ''),
        link: `/desk/invoices/${r.r.invoiceId}`,
      });
    }
    if (input.approve) {
      await this.billing.deliverToClient(tenantId, r.r.clientId, 'refund_decided', {
        title: `A refund of ${formatMoney(r.r.amount, r.r.currency)} is on its way`,
        body: `Receipt ${paymentNumber}.`,
        link: '/portal/payments',
      });
    }
    return (await refundRequestRows(this.db, eq(refundRequests.id, id), 1))[0]!;
  }

  async cancel(actor: AuthUser, id: string): Promise<RefundRequestView> {
    const [r] = await this.db
      .select({ r: refundRequests })
      .from(refundRequests)
      .innerJoin(clients, eq(clients.id, refundRequests.clientId))
      .where(and(eq(refundRequests.id, id), this.scope(actor)))
      .limit(1);
    if (!r) throw new NotFoundException('Refund request not found.');
    if (r.r.requestedBy !== actor.id && actor.role !== 'manager') throw new ForbiddenException('Only whoever asked (or a manager) can withdraw it.');
    const [done] = await this.db
      .update(refundRequests)
      .set({ status: 'cancelled', decidedBy: actor.id, decidedAt: new Date() })
      .where(and(eq(refundRequests.id, id), eq(refundRequests.status, 'pending')))
      .returning({ id: refundRequests.id });
    if (!done) throw new BadRequestException('This request has already been decided.');
    await this.audit.record(actor, { action: 'refund.rejected', entityType: 'refund_request', entityId: id, clientId: r.r.clientId, metadata: { withdrawn: true } });
    return (await refundRequestRows(this.db, eq(refundRequests.id, id), 1))[0]!;
  }
}
