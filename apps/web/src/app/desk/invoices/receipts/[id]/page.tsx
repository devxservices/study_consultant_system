import { notFound } from 'next/navigation';
import type { InvoiceView, PaymentView } from '@crm/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { requireRole } from '@/lib/session';
import { can } from '@/lib/permissions';
import { NoAccess } from '@/components/no-access';
import { Receipt } from '@/components/billing/receipt';

export const metadata = { title: 'Receipt' };

export default async function DeskReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('consultant');
  if (!can(user, 'billing.view')) return <NoAccess title="Receipt" permission="billing.view" />;
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
      backHref={`/desk/invoices/${data.invoice.id}`}
      backLabel={`Back to ${data.invoice.number}`}
    />
  );
}
