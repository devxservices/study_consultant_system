import Link from 'next/link';
import {
  localIsoDate,
  PAYMENT_METHOD_LABEL,
  QUOTE_STATUS_LABEL,
  QUOTE_STATUS_TONE,
  formatMoney,
  type BillingTotals,
  type InvoiceSummaryView,
  type Paginated,
  type PaymentSubmissionView,
  type PaymentView,
  type QuoteView,
} from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { requireRole } from '@/lib/session';
import { formatDate } from '@/lib/format';
import { Card, PageHeader, Panel, Pill, cx } from '@/components/ui';
import { InvoiceTable } from '@/components/billing/invoice-table';
import { IconCheck, IconWallet } from '@/components/icons';

export const metadata = { title: 'Payments' };

/**
 * "How much do I still owe, and by when?" answered first. Then what needs
 * an answer (quotes), what is being checked (proofs), every invoice and
 * every receipt, each of which opens as a printable document.
 */
export default async function PortalPaymentsPage() {
  await requireRole('client');
  const [totals, invoices, payments, quotes, proofs] = await Promise.all([
    apiFetch<BillingTotals[]>('/billing/totals'),
    apiFetch<Paginated<InvoiceSummaryView>>('/billing/invoices?pageSize=50'),
    apiFetch<PaymentView[]>('/billing/payments?limit=50'),
    apiFetch<Paginated<QuoteView>>('/billing/quotes?pageSize=20').catch(() => ({ items: [] as QuoteView[] })),
    apiFetch<PaymentSubmissionView[]>('/billing/submissions').catch(() => [] as PaymentSubmissionView[]),
  ]);

  const main = totals[0];
  const owed = main?.outstanding ?? 0;
  const open = invoices.items.filter((i) => i.status === 'issued' && i.balance > 0);
  // The next thing to pay: the earliest installment or due date still open.
  const next = open
    .map((i) => ({ invoice: i, dueDate: i.nextDue?.dueDate ?? i.dueDate, amount: i.nextDue?.amount ?? i.balance }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const waitingQuotes = quotes.items.filter((q) => q.status === 'sent');
  const checking = proofs.filter((p) => p.status === 'pending');

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Your invoices from the consultancy, what is due when, and receipts for everything you have paid."
        actions={
          invoices.items.length > 0 ? (
            <Link href="/portal/payments/statement" className="inline-flex h-9.5 items-center rounded-lg border border-line-strong bg-paper px-3 text-[13.5px] font-medium text-ink-800 hover:bg-ink-50">
              Statement
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className={cx('rounded-xl p-5 shadow-card lg:col-span-2', owed > 0 ? 'bg-paper' : 'bg-ok-50')}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[13px] text-ink-500">{owed > 0 ? 'You still owe' : 'All paid up'}</p>
              <p className="tnum mt-1 text-[34px] font-semibold leading-10 tracking-[-0.02em] text-ink-950">{formatMoney(owed, main?.currency ?? 'PKR')}</p>
              {next ? (
                <p className={cx('mt-1 text-[13.5px]', next.dueDate < localIsoDate() ? 'font-medium text-bad-700' : 'text-ink-600')}>
                  Next: {formatMoney(next.amount, next.invoice.currency)} {next.dueDate < localIsoDate() ? 'was due' : 'due'} {formatDate(next.dueDate)} - invoice {next.invoice.number}
                </p>
              ) : (
                <p className="mt-1 text-[13.5px] text-ok-700">Nothing is outstanding. Thank you.</p>
              )}
            </div>
            <span className={cx('flex size-12 shrink-0 items-center justify-center rounded-xl', owed > 0 ? 'bg-info-50 text-info-600' : 'bg-ok-50 text-ok-600')}>
              {owed > 0 ? <IconWallet size={22} /> : <IconCheck size={22} />}
            </span>
          </div>
          {next && (
            <Link
              href={`/portal/payments/invoices/${next.invoice.id}`}
              className="press mt-4 inline-flex h-9 items-center rounded-lg bg-brand-600 px-4 text-[14px] font-medium text-white hover:brightness-[0.93]"
            >
              Pay or send proof of payment
            </Link>
          )}
          {checking.length > 0 && (
            <p className="mt-3 text-[12.5px] text-ink-500">
              {checking.length === 1 ? 'A payment you sent is' : `${checking.length} payments you sent are`} being checked ({checking.map((c) => formatMoney(c.amount, c.currency)).join(', ')}). You will get a receipt when confirmed.
            </p>
          )}
        </section>

        <Card className="p-5">
          <p className="text-[13px] text-ink-500">Paid so far</p>
          <p className="tnum mt-1 text-[24px] font-semibold text-ink-950">{formatMoney(main?.collected ?? 0, main?.currency ?? 'PKR')}</p>
          <p className="text-[12.5px] text-ink-400">of {formatMoney(main?.invoiced ?? 0, main?.currency ?? 'PKR')} invoiced</p>
          <p className="mt-4 text-[12px] leading-relaxed text-ink-400">
            The consultancy’s fees, and any fees it paid on your behalf. Tuition you pay the university directly is not shown here.
          </p>
        </Card>
      </div>

      {waitingQuotes.length > 0 && (
        <Panel title="Quotes waiting for your answer" className="mt-5" bodyClassName="pb-2">
          <ul className="divide-y divide-line">
            {waitingQuotes.map((q) => (
              <li key={q.id}>
                <Link href={`/portal/payments/quotes/${q.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-ink-50 sm:px-5">
                  <div className="min-w-0">
                    <p className="font-mono text-[13px] font-medium text-ink-900">{q.number}</p>
                    <p className="text-[12px] text-ink-400">Valid until {formatDate(q.validUntil)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Pill tone={QUOTE_STATUS_TONE[q.status]}>{QUOTE_STATUS_LABEL[q.status]}</Pill>
                    <span className="tnum text-[14px] font-semibold text-ink-950">{formatMoney(q.total, q.currency)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="Invoices" bodyClassName="">
          <InvoiceTable invoices={invoices.items} hrefBase="/portal/payments/invoices" showClient={false} empty="No invoices yet." />
        </Panel>

        <Panel title="Receipts" subtitle="Tap one to print or save it" bodyClassName="pb-2">
          {payments.length === 0 ? (
            <p className="px-4 pb-4 text-[13px] text-ink-400 sm:px-5">No payments recorded yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {payments
                .filter((p) => !p.voided)
                .map((p) => (
                  <li key={p.id}>
                    <Link href={`/portal/payments/receipts/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-ink-50 sm:px-5">
                      <div className="min-w-0">
                        <p className="font-mono text-[12.5px] font-medium text-ink-900">{p.number}</p>
                        <p className="text-[12px] text-ink-400">
                          {formatDate(p.receivedOn)} · {PAYMENT_METHOD_LABEL[p.method]}
                        </p>
                      </div>
                      <span className={cx('tnum text-[14px] font-semibold', p.kind === 'refund' ? 'text-bad-700' : 'text-ok-700')}>
                        {p.kind === 'refund' ? '−' : ''}
                        {formatMoney(p.amount, p.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
