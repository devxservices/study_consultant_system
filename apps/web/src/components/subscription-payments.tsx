import { PAYMENT_METHOD_LABEL, formatMoney, type SubscriptionPaymentView } from '@crm/shared';
import { formatDate } from '@/lib/format';
import { EmptyState } from './ui';

/** Payments made for the platform, newest first: what came in and the period it paid for. */
export function SubscriptionPayments({ payments, showRecordedBy = false }: { payments: SubscriptionPaymentView[]; showRecordedBy?: boolean }) {
  if (!payments.length) {
    return <EmptyState compact title="No payments yet" description="Each payment shows here with the period it covers." />;
  }
  return (
    <div className="scroll-x">
      <table className="w-full min-w-[560px] text-left text-[13.5px]">
        <thead>
          <tr className="border-b border-line text-[12.5px] text-ink-500">
            <th className="px-4 py-2.5 font-medium sm:px-5">Received</th>
            <th className="px-3 py-2.5 text-right font-medium">Amount</th>
            <th className="px-3 py-2.5 font-medium">Covers</th>
            <th className="px-3 py-2.5 font-medium">How</th>
            {showRecordedBy && <th className="px-3 py-2.5 font-medium">Recorded by</th>}
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} className="border-b border-line last:border-0">
              <td className="px-4 py-2.5 text-ink-800 sm:px-5">{formatDate(p.receivedOn)}</td>
              <td className="tnum px-3 py-2.5 text-right font-medium text-ink-950">{formatMoney(p.amount, p.currency)}</td>
              <td className="px-3 py-2.5 text-ink-700">
                {formatDate(p.periodFrom)} – {formatDate(p.periodTo)}
                <span className="text-ink-400"> · {p.months === 1 ? '1 month' : `${p.months} months`}</span>
              </td>
              <td className="px-3 py-2.5 text-ink-700">
                {PAYMENT_METHOD_LABEL[p.method]}
                {p.reference && <span className="block text-[12px] text-ink-400">{p.reference}</span>}
              </td>
              {showRecordedBy && <td className="px-3 py-2.5 text-ink-500">{p.recordedBy ?? '--'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
