import { notFound } from 'next/navigation';
import type { InvoiceView } from '@crm/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { requireRole } from '@/lib/session';
import { can } from '@/lib/permissions';
import { NoAccess } from '@/components/no-access';
import { InvoiceDetail } from '@/components/billing/invoice-detail';

export const metadata = { title: 'Invoice' };

export default async function DeskInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('consultant');
  if (!can(user, 'billing.view')) return <NoAccess title="Invoice" permission="billing.view" />;
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
      backHref="/desk/invoices"
      backLabel="Back to invoices"
      receiptBase="/desk/invoices/receipts"
      clientHref={`/desk/clients/${invoice.clientId}`}
      statementHref={`/desk/invoices/statement/${invoice.clientId}?currency=${invoice.currency}`}
    />
  );
}
