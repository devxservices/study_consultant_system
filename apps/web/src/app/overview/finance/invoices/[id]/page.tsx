import { notFound } from 'next/navigation';
import type { InvoiceView } from '@crm/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { requireRole } from '@/lib/session';
import { InvoiceDetail } from '@/components/billing/invoice-detail';

export const metadata = { title: 'Invoice' };

export default async function OverviewInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('manager');
  const { id } = await params;
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
      backHref="/overview/finance/invoices"
      backLabel="Back to invoices"
      receiptBase="/overview/finance/receipts"
      clientHref={`/overview/clients/${invoice.clientId}`}
      statementHref={`/overview/finance/statement/${invoice.clientId}?currency=${invoice.currency}`}
    />
  );
}
