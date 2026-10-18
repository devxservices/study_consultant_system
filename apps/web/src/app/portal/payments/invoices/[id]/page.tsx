import { notFound } from 'next/navigation';
import type { InvoiceView } from '@crm/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { requireRole } from '@/lib/session';
import { InvoiceDetail } from '@/components/billing/invoice-detail';

export const metadata = { title: 'Invoice' };

export default async function PortalInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string; cancelled?: string }>;
}) {
  const user = await requireRole('client');
  const [{ id }, q] = await Promise.all([params, searchParams]);
  let invoice: InvoiceView;
  try {
    invoice = await apiFetch<InvoiceView>(`/billing/invoices/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  return (
    <InvoiceDetail
      invoice={invoice}
      user={user}
      backHref="/portal/payments"
      backLabel="Back to payments"
      receiptBase="/portal/payments/receipts"
      statementHref={`/portal/payments/statement?currency=${invoice.currency}`}
      flash={q.paid ? 'paid' : q.cancelled ? 'cancelled' : null}
    />
  );
}
