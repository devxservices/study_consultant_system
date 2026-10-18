import { PageStamp } from '../page-stamp';
import Link from 'next/link';
import {
  PAYMENT_METHOD_LABEL,
  formatMoney,
  type InvoiceView,
  type PaymentView,
} from '@crm/shared';
import { getSite, siteBranding, siteName } from '@/lib/site';
import { formatDate } from '@/lib/format';
import { BrandMark } from '../brand-mark';
import { Card, cx } from '../ui';
import { PrintButton } from './payment-form';

/**
 * A receipt: proof that money changed hands, for the client to keep. Printed
 * on its own page so it can be handed over or saved as a PDF.
 */
export async function Receipt({
  invoice,
  payment,
  backHref,
  backLabel,
}: {
  invoice: InvoiceView;
  payment: PaymentView;
  backHref: string;
  backLabel: string;
}) {
  const site = await getSite();
  const branding = siteBranding(site);
  const name = siteName(site);
  const refund = payment.kind === 'refund';

  return (
    <div>
      <PageStamp />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={backHref} className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
          <span aria-hidden>&larr;</span> {backLabel}
        </Link>
        <div className="flex gap-2">
          <a href={`/api/billing/payments/${payment.id}/pdf?download=1`} className="inline-flex h-9.5 items-center rounded-lg border border-line-strong bg-paper px-3 text-[13.5px] font-medium text-ink-800 hover:bg-ink-50">
            Download PDF
          </a>
          <PrintButton label="Print receipt" />
        </div>
      </div>

      <Card className="relative mx-auto max-w-3xl overflow-hidden p-6 sm:p-10 print:max-w-none print:shadow-none">
        {payment.voided && (
          <span className="pointer-events-none absolute right-8 top-20 rotate-[-12deg] rounded-lg border-4 border-bad-500/60 px-4 py-1 text-[30px] font-bold tracking-widest text-bad-500/60">
            VOID
          </span>
        )}
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-6">
          <div className="flex items-center gap-3">
            <BrandMark name={name} branding={branding} size={48} />
            <div>
              <p className="text-[17px] font-semibold text-ink-950">{name}</p>
              {branding?.contactEmail && <p className="text-[12.5px] text-ink-500">{branding.contactEmail}</p>}
              {branding?.contactPhone && <p className="text-[12.5px] text-ink-500">{branding.contactPhone}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">
              {refund ? 'Refund note' : 'Payment receipt'}
            </p>
            <p className="font-mono text-[20px] font-semibold text-ink-950">{payment.number}</p>
            <p className="mt-1 text-[12.5px] text-ink-500">{formatDate(payment.receivedOn)}</p>
          </div>
        </header>

        <div className="py-8 text-center">
          <p className="text-[13px] text-ink-500">
            {refund ? 'Refunded to' : 'Received with thanks from'}
          </p>
          <p className="mt-1 text-[20px] font-semibold text-ink-950">{invoice.clientName}</p>
          <p className={cx('tnum mt-4 text-[40px] font-bold leading-none', refund ? 'text-bad-700' : 'text-ink-950')}>
            {formatMoney(payment.amount, payment.currency)}
          </p>
        </div>

        <dl className="grid gap-x-8 gap-y-3 border-t border-line pt-6 text-[13.5px] sm:grid-cols-2">
          <Row label="Against invoice" value={invoice.number} mono />
          <Row label="Method" value={PAYMENT_METHOD_LABEL[payment.method]} />
          {payment.reference && <Row label="Reference" value={payment.reference} mono />}
          <Row label="Recorded by" value={payment.recordedByName ?? '—'} />
          <Row label="Invoice total" value={formatMoney(invoice.total, invoice.currency)} />
          <Row label="Balance now" value={formatMoney(Math.max(0, invoice.balance), invoice.currency)} />
        </dl>

        {payment.voided && (
          <p className="mt-6 rounded-lg bg-bad-50 p-3 text-[12.5px] text-bad-700">
            This entry was voided{payment.voidedAt ? ` on ${formatDate(payment.voidedAt)}` : ''}
            {payment.voidReason ? `: ${payment.voidReason}` : '.'} It does not count towards the balance.
          </p>
        )}
        <p className="mt-10 text-center text-[11.5px] text-ink-400">
          Computer-generated receipt. Keep it for your records.
        </p>
      </Card>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className={cx('text-right font-medium text-ink-900', mono && 'font-mono text-[13px]')}>{value}</dd>
    </div>
  );
}

export function findPayment(invoice: InvoiceView, paymentId: string): PaymentView | undefined {
  return invoice.payments.find((p) => p.id === paymentId);
}
