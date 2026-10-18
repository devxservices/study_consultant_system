import { notFound } from 'next/navigation';
import { formatMoney, type OnlinePaymentView } from '@crm/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { requireRole } from '@/lib/session';
import { TestCheckout } from './test-checkout';

export const metadata = { title: 'Test payment' };

/**
 * The test payment provider's "checkout": what a card page would be, with
 * Pay and Cancel. Only for development and demos - the API refuses test
 * payments on a live server.
 */
export default async function TestCheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('client');
  let op: OnlinePaymentView;
  try {
    op = await apiFetch<OnlinePaymentView>(`/billing/online/${(await params).id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-paper p-6 shadow-raise">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-warn-700">Test mode · no real money</p>
        <h1 className="mt-2 text-[18px] font-semibold text-ink-950">Pay invoice {op.invoiceNumber}</h1>
        <p className="tnum mt-3 text-[32px] font-semibold text-ink-950">{formatMoney(op.amount, op.currency)}</p>
        <p className="text-[13px] text-ink-500">{op.clientName}</p>
        <TestCheckout id={op.id} invoiceId={op.invoiceId} status={op.status} />
      </div>
    </main>
  );
}
