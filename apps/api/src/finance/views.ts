import { and, desc, eq, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  CreditNoteView,
  Currency,
  PaymentMethod,
  PaymentSubmissionView,
  RefundRequestView,
  RefundStatus,
  SubmissionStatus,
} from '@crm/shared';
import type { Db } from '../db/connection';
import { clients, creditNotes, documents, invoices, paymentSubmissions, payments, refundRequests, users } from '../db/schema';
import { iso, isoOrNull } from '../common/db-helpers';

/*
 * The finance records an invoice page and the work queues both show. Plain
 * queries over a condition the caller builds (which carries its scope), so
 * the invoice page and the queues read them the same way without the
 * services depending on each other.
 */

export async function creditNoteRows(db: Db, where: SQL | undefined, limit = 200): Promise<CreditNoteView[]> {
  const creator = alias(users, 'cn_creator');
  const rows = await db
    .select({ c: creditNotes, invoiceNumber: invoices.number, clientName: clients.fullName, createdByName: creator.fullName })
    .from(creditNotes)
    .innerJoin(invoices, eq(invoices.id, creditNotes.invoiceId))
    .innerJoin(clients, eq(clients.id, creditNotes.clientId))
    .leftJoin(creator, eq(creator.id, creditNotes.createdBy))
    .where(where)
    .orderBy(desc(creditNotes.issuedOn), desc(creditNotes.number))
    .limit(limit);
  return rows.map((r) => ({
    id: r.c.id,
    number: r.c.number,
    invoiceId: r.c.invoiceId,
    invoiceNumber: r.invoiceNumber,
    clientId: r.c.clientId,
    clientName: r.clientName,
    amount: r.c.amount,
    taxAmount: r.c.taxAmount,
    currency: r.c.currency as Currency,
    reason: r.c.reason,
    issuedOn: r.c.issuedOn,
    createdByName: r.createdByName,
    voided: Boolean(r.c.voidedAt),
    voidReason: r.c.voidReason,
  }));
}

export async function refundRequestRows(db: Db, where: SQL | undefined, limit = 200): Promise<RefundRequestView[]> {
  const requester = alias(users, 'rr_requester');
  const decider = alias(users, 'rr_decider');
  const rows = await db
    .select({
      r: refundRequests,
      invoiceNumber: invoices.number,
      clientName: clients.fullName,
      requestedByName: requester.fullName,
      decidedByName: decider.fullName,
    })
    .from(refundRequests)
    .innerJoin(invoices, eq(invoices.id, refundRequests.invoiceId))
    .innerJoin(clients, eq(clients.id, refundRequests.clientId))
    .leftJoin(requester, eq(requester.id, refundRequests.requestedBy))
    .leftJoin(decider, eq(decider.id, refundRequests.decidedBy))
    .where(where)
    .orderBy(desc(refundRequests.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.r.id,
    invoiceId: r.r.invoiceId,
    invoiceNumber: r.invoiceNumber,
    clientId: r.r.clientId,
    clientName: r.clientName,
    amount: r.r.amount,
    currency: r.r.currency as Currency,
    method: r.r.method as PaymentMethod,
    reason: r.r.reason,
    status: r.r.status as RefundStatus,
    requestedById: r.r.requestedBy,
    requestedByName: r.requestedByName,
    decidedByName: r.decidedByName,
    decidedAt: isoOrNull(r.r.decidedAt),
    decisionNote: r.r.decisionNote,
    paymentId: r.r.paymentId,
    createdAt: iso(r.r.createdAt),
  }));
}

export async function submissionRows(db: Db, where: SQL | undefined, limit = 200): Promise<PaymentSubmissionView[]> {
  const reviewer = alias(users, 'ps_reviewer');
  const receipt = alias(payments, 'ps_receipt');
  const rows = await db
    .select({
      s: paymentSubmissions,
      invoiceNumber: invoices.number,
      clientName: clients.fullName,
      fileName: documents.fileName,
      reviewedByName: reviewer.fullName,
      receiptNumber: receipt.number,
    })
    .from(paymentSubmissions)
    .innerJoin(invoices, eq(invoices.id, paymentSubmissions.invoiceId))
    .innerJoin(clients, eq(clients.id, paymentSubmissions.clientId))
    .leftJoin(documents, eq(documents.id, paymentSubmissions.documentId))
    .leftJoin(reviewer, eq(reviewer.id, paymentSubmissions.reviewedBy))
    .leftJoin(receipt, eq(receipt.id, paymentSubmissions.paymentId))
    .where(where)
    .orderBy(desc(paymentSubmissions.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.s.id,
    invoiceId: r.s.invoiceId,
    invoiceNumber: r.invoiceNumber,
    clientId: r.s.clientId,
    clientName: r.clientName,
    amount: r.s.amount,
    currency: r.s.currency as Currency,
    method: r.s.method as PaymentMethod,
    reference: r.s.reference,
    paidOn: r.s.paidOn,
    note: r.s.note,
    status: r.s.status as SubmissionStatus,
    documentId: r.s.documentId,
    fileName: r.fileName,
    reviewNote: r.s.reviewNote,
    reviewedByName: r.reviewedByName,
    reviewedAt: isoOrNull(r.s.reviewedAt),
    paymentId: r.s.paymentId,
    receiptNumber: r.receiptNumber,
    createdAt: iso(r.s.createdAt),
  }));
}

/** Scope helpers: everything of one invoice, inside a consultancy. */
export const ofInvoice = {
  creditNotes: (tenantId: string, invoiceId: string) => and(eq(creditNotes.tenantId, tenantId), eq(creditNotes.invoiceId, invoiceId)),
  refunds: (tenantId: string, invoiceId: string) => and(eq(refundRequests.tenantId, tenantId), eq(refundRequests.invoiceId, invoiceId)),
  submissions: (tenantId: string, invoiceId: string) => and(eq(paymentSubmissions.tenantId, tenantId), eq(paymentSubmissions.invoiceId, invoiceId)),
};
