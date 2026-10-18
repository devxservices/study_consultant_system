import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import {
  formatMoney,
  reviewSubmissionSchema,
  submitPaymentSchema,
  type AuthUser,
  type PaymentMethod,
  type PaymentSubmissionView,
  type ReviewSubmissionInput,
  type SubmitPaymentInput,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { clients, documents, paymentSubmissions } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { seesAll, staffCan } from '../auth/permissions';
import { NIL_UUID, today } from '../common/db-helpers';
import { permissionHolders } from '../common/permission-holders';
import { BillingService } from '../billing/billing.service';
import { DocumentsService } from '../documents/documents.service';
import { submissionRows } from './views';

/**
 * "I have paid": a student uploads a bank slip or a screenshot of a transfer
 * against an invoice. It is filed in their Financial folder and waits for
 * someone with "Verify payments" to check it against the bank - approving
 * records the payment (and issues the receipt), rejecting tells the student
 * what is wrong.
 */
@Injectable()
export class SubmissionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly billing: BillingService,
    private readonly documents: DocumentsService,
  ) {}

  private scope(actor: AuthUser): SQL | undefined {
    const tenant = eq(paymentSubmissions.tenantId, tenantOf(actor));
    if (actor.role === 'client') return and(tenant, eq(paymentSubmissions.clientId, actor.clientId ?? NIL_UUID));
    if (actor.role === 'manager' || seesAll(actor)) return tenant;
    if (actor.role === 'consultant') return and(tenant, eq(clients.assignedConsultantId, actor.consultantId ?? NIL_UUID));
    return sql`false`;
  }

  async list(actor: AuthUser, status?: string): Promise<PaymentSubmissionView[]> {
    if (actor.role === 'consultant' && !staffCan(actor, 'billing.verify') && !staffCan(actor, 'billing.view')) {
      throw new ForbiddenException('You do not have permission to see payments.');
    }
    return submissionRows(
      this.db,
      and(this.scope(actor), status && status !== 'all' ? eq(paymentSubmissions.status, status) : undefined),
      200,
    );
  }

  async submit(
    actor: AuthUser,
    invoiceId: string,
    raw: SubmitPaymentInput,
    file: { buffer: Buffer; originalname: string; size: number },
  ): Promise<PaymentSubmissionView> {
    if (actor.role !== 'client') throw new ForbiddenException('Staff record payments directly.');
    const input = submitPaymentSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const invoice = await this.billing.get(actor, invoiceId);
    if (invoice.status !== 'issued') throw new BadRequestException('This invoice cannot be paid.');
    const [waiting] = await this.db
      .select({ n: sql<number>`coalesce(sum(${paymentSubmissions.amount}), 0)::bigint` })
      .from(paymentSubmissions)
      .where(and(eq(paymentSubmissions.invoiceId, invoiceId), eq(paymentSubmissions.status, 'pending')));
    const room = invoice.balance - Number(waiting?.n ?? 0);
    if (input.amount > room) {
      throw new BadRequestException({
        message:
          room <= 0
            ? 'Everything on this invoice is paid or already waiting to be checked.'
            : `At most ${formatMoney(room, invoice.currency)} is still owed on this invoice (after what is already waiting to be checked).`,
        fieldErrors: { amount: 'More than is owed' },
      });
    }
    if (input.paidOn > today()) throw new BadRequestException({ message: 'That date is in the future.', fieldErrors: { paidOn: 'When did you pay?' } });

    const valid = await this.documents.accept(actor, file);
    const doc = await this.documents.store(actor, { clientId: actor.clientId, caseId: invoice.caseId, typeKey: 'payment_proof' }, valid);
    const [row] = await this.db
      .insert(paymentSubmissions)
      .values({
        tenantId,
        invoiceId,
        clientId: invoice.clientId,
        amount: input.amount,
        currency: invoice.currency,
        method: input.method,
        reference: input.reference,
        paidOn: input.paidOn,
        note: input.note,
        documentId: doc.id,
        submittedBy: actor.id,
      })
      .returning();
    await this.audit.record(actor, {
      action: 'payment_proof.submitted',
      entityType: 'payment_submission',
      entityId: row!.id,
      clientId: invoice.clientId,
      metadata: { invoice: invoice.number, amount: input.amount, currency: invoice.currency, method: input.method },
    });

    const checkers = await permissionHolders(this.db, tenantId, 'billing.verify');
    const title = `${invoice.clientName} paid ${formatMoney(input.amount, invoice.currency)} - please check`;
    const body = `Proof of payment for invoice ${invoice.number}${input.reference ? `, reference ${input.reference}` : ''}.`;
    for (const userId of checkers) {
      const [u] = await this.db.execute<{ role: string }>(sql`select role from users where id = ${userId}`).then(
        (r) => (r as unknown as { rows?: { role: string }[] }).rows ?? (r as unknown as { role: string }[]),
      );
      await this.notifications.push({
        userId,
        type: 'payment_submitted',
        title,
        body,
        link: u?.role === 'manager' ? '/overview/finance/verify' : '/desk/finance/verify',
        email: true,
      });
    }
    return (await submissionRows(this.db, eq(paymentSubmissions.id, row!.id), 1))[0]!;
  }

  async review(actor: AuthUser, id: string, raw: ReviewSubmissionInput): Promise<PaymentSubmissionView> {
    if (!staffCan(actor, 'billing.verify')) throw new ForbiddenException('You do not have permission to verify payments.');
    const input = reviewSubmissionSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const [s] = await this.db
      .select({ s: paymentSubmissions })
      .from(paymentSubmissions)
      .innerJoin(clients, eq(clients.id, paymentSubmissions.clientId))
      .where(and(eq(paymentSubmissions.id, id), this.scope(actor)))
      .limit(1);
    if (!s) throw new NotFoundException('Submission not found.');
    // Claimed first, so two people checking at once cannot both record it.
    const [claimed] = await this.db
      .update(paymentSubmissions)
      .set({ status: 'reviewing' })
      .where(and(eq(paymentSubmissions.id, id), eq(paymentSubmissions.status, 'pending')))
      .returning({ id: paymentSubmissions.id });
    if (!claimed) throw new BadRequestException('This proof has already been checked.');

    try {
      if (input.approve) {
        const invoice = await this.billing.view(tenantId, s.s.invoiceId);
        const payment = await this.billing.recordInternal(
          tenantId,
          invoice,
          {
            kind: 'payment',
            amount: input.amount ?? s.s.amount,
            method: s.s.method as PaymentMethod,
            reference: s.s.reference,
            receivedOn: input.receivedOn ?? s.s.paidOn,
            note: input.note ?? 'Proof of payment checked',
            accountId: input.accountId ?? null,
          },
          actor,
        );
        await this.db
          .update(paymentSubmissions)
          .set({ status: 'approved', reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: input.note, paymentId: payment.id })
          .where(eq(paymentSubmissions.id, id));
        if (s.s.documentId) {
          await this.db.update(documents).set({ status: 'verified', reviewedBy: actor.id, reviewedAt: new Date() }).where(eq(documents.id, s.s.documentId));
        }
        await this.audit.record(actor, {
          action: 'payment_proof.approved',
          entityType: 'payment_submission',
          entityId: id,
          clientId: s.s.clientId,
          metadata: { invoice: invoice.number, receipt: payment.number, amount: payment.amount, claimed: s.s.amount },
        });
      } else {
        await this.db
          .update(paymentSubmissions)
          .set({ status: 'rejected', reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: input.note })
          .where(eq(paymentSubmissions.id, id));
        if (s.s.documentId) {
          await this.db
            .update(documents)
            .set({ status: 'rejected', reviewedBy: actor.id, reviewedAt: new Date(), reviewerComment: input.note })
            .where(eq(documents.id, s.s.documentId));
        }
        await this.audit.record(actor, {
          action: 'payment_proof.rejected',
          entityType: 'payment_submission',
          entityId: id,
          clientId: s.s.clientId,
          metadata: { amount: s.s.amount, note: input.note },
        });
        await this.billing.deliverToClient(tenantId, s.s.clientId, 'payment_reviewed', {
          title: `We could not confirm your payment of ${formatMoney(s.s.amount, s.s.currency)}`,
          body: input.note ?? '',
          link: `/portal/payments/invoices/${s.s.invoiceId}`,
        });
      }
    } catch (err) {
      // Whatever went wrong, the proof goes back in the queue rather than vanishing.
      await this.db.update(paymentSubmissions).set({ status: 'pending' }).where(and(eq(paymentSubmissions.id, id), eq(paymentSubmissions.status, 'reviewing')));
      throw err;
    }
    return (await submissionRows(this.db, eq(paymentSubmissions.id, id), 1))[0]!;
  }
}
