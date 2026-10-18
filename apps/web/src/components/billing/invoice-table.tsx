import Link from 'next/link';
import {
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  formatMoney,
  type InvoiceSummaryView,
} from '@crm/shared';
import { formatDate } from '@/lib/format';
import { Pill, cx } from '../ui';

/**
 * Invoices as a table on a desktop and stacked rows on a phone. The balance is
 * the column the eye lands on last, because it is the one anyone acts on.
 */
export function InvoiceTable({
  invoices,
  hrefBase,
  showClient = true,
  empty = 'No invoices here yet.',
}: {
  invoices: InvoiceSummaryView[];
  /** Where an invoice opens, e.g. /overview/finance/invoices */
  hrefBase: string;
  showClient?: boolean;
  empty?: string;
}) {
  if (invoices.length === 0) {
    return <p className="px-4 py-8 text-center text-[13px] text-ink-400 sm:px-5">{empty}</p>;
  }

  return (
    <>
      <table className="hidden w-full text-left text-[13.5px] md:table">
        <thead>
          <tr className="border-b border-line text-[12.5px] text-ink-500">
            <th className="px-5 py-3 font-medium">Invoice</th>
            {showClient && <th className="px-3 py-3 font-medium">Client</th>}
            <th className="px-3 py-3 font-medium">Issued</th>
            <th className="px-3 py-3 font-medium">Due</th>
            <th className="px-3 py-3 font-medium">Status</th>
            <th className="px-3 py-3 text-right font-medium">Total</th>
            <th className="px-5 py-3 text-right font-medium">Balance</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} className="border-b border-line last:border-0 hover:bg-ink-50/60">
              <td className="px-5 py-3">
                <Link href={`${hrefBase}/${inv.id}`} className="font-mono text-[13px] font-medium text-ink-950 hover:text-brand-700 hover:underline">
                  {inv.number}
                </Link>
                {inv.caseReference && <p className="text-[12px] text-ink-400">{inv.caseReference}</p>}
              </td>
              {showClient && <td className="px-3 py-3 text-ink-800">{inv.clientName}</td>}
              <td className="tnum px-3 py-3 text-ink-500">{formatDate(inv.issueDate)}</td>
              <td className={cx('tnum px-3 py-3', inv.overdue ? 'font-medium text-bad-700' : 'text-ink-500')}>
                {/* Paid in installments: the one due next, which is what "overdue" is about. */}
                {formatDate(inv.nextDue?.dueDate ?? inv.dueDate)}
              </td>
              <td className="px-3 py-3">
                <Pill tone={inv.overdue ? 'bad' : PAYMENT_STATUS_TONE[inv.paymentStatus]} dot>
                  {inv.overdue ? 'Overdue' : PAYMENT_STATUS_LABEL[inv.paymentStatus]}
                </Pill>
              </td>
              <td className="tnum px-3 py-3 text-right text-ink-700">{formatMoney(inv.total, inv.currency)}</td>
              <td className={cx('tnum px-5 py-3 text-right font-semibold', inv.balance > 0 ? 'text-ink-950' : 'text-ink-400')}>
                {inv.status === 'void' ? '—' : formatMoney(inv.balance, inv.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-line md:hidden">
        {invoices.map((inv) => (
          <li key={inv.id}>
            <Link href={`${hrefBase}/${inv.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-mono text-[13px] font-medium text-ink-950">{inv.number}</p>
                <p className="truncate text-[12px] text-ink-400">
                  {showClient ? `${inv.clientName} · ` : ''}due {formatDate(inv.nextDue?.dueDate ?? inv.dueDate)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="tnum text-[14px] font-semibold text-ink-950">
                  {inv.status === 'void' ? '—' : formatMoney(inv.balance, inv.currency)}
                </p>
                <Pill tone={inv.overdue ? 'bad' : PAYMENT_STATUS_TONE[inv.paymentStatus]}>
                  {inv.overdue ? 'Overdue' : PAYMENT_STATUS_LABEL[inv.paymentStatus]}
                </Pill>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
