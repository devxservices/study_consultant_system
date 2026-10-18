import { notFound } from 'next/navigation';
import type { InvoiceView, PaymentView } from '@crm/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { requireRole } from '@/lib/session';
import { Receipt } from '@/components/billing/receipt';

export const metadata = { title: 'Receipt' };

export default async function OverviewReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('manager');
  const { id } = await params;
  let data: { invoice: InvoiceView; payment: PaymentView };
  try {
    data = await apiFetch<{ invoice: InvoiceView; payment: PaymentView }>(`/billing/payments/${id}/receipt`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  return (
    <Receipt
      invoice={data.invoice}
      payment={data.payment}
      backHref={`/overview/finance/invoices/${data.invoice.id}`}
      backLabel={`Back to ${data.invoice.number}`}
    />
  );
}
