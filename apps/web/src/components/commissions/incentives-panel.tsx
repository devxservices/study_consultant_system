import Link from 'next/link';
import { COMMISSION_STAGE_LABEL, formatMoney, type CommissionSplitView, type CommissionView } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Panel, Pill } from '../ui';

type MySplit = CommissionSplitView & { commission: Pick<CommissionView, 'id' | 'number' | 'clientName' | 'institutionName' | 'stage'> };

/**
 * Someone's own share of the commission they brought in: what is due to
 * them, what is waiting on the university, and what has been paid. Nothing
 * when they share in none.
 */
export async function MyIncentivesPanel({ commissionHref, className }: { commissionHref: ((id: string) => string) | null; className?: string }) {
  const { splits } = await apiFetch<{ splits: MySplit[] }>('/commissions/incentives/mine').catch(() => ({ splits: [] as MySplit[] }));
  if (splits.length === 0) return null;
  const sum = (list: MySplit[]) => {
    const by = new Map<string, number>();
    for (const s of list) by.set(s.currency, (by.get(s.currency) ?? 0) + (s.paidAmount ?? s.amount));
    return [...by].map(([c, n]) => formatMoney(n, c)).join(' + ') || '–';
  };
  const due = splits.filter((s) => s.payable && !s.paidOn);
  const waiting = splits.filter((s) => !s.payable && !s.paidOn);
  const paid = splits.filter((s) => s.paidOn);
  const order = [...due, ...waiting, ...paid].slice(0, 12);
  return (
    <Panel title="My incentives" subtitle="Your share of the commission on your students" className={className}>
      <dl className="mb-4 grid grid-cols-3 gap-3 text-[12.5px]">
        <div>
          <dt className="text-ink-400">Due to you</dt>
          <dd className="tnum text-[15px] font-semibold text-warn-700">{sum(due)}</dd>
        </div>
        <div>
          <dt className="text-ink-400">When the university pays</dt>
          <dd className="tnum text-[15px] font-semibold text-ink-800">{sum(waiting)}</dd>
        </div>
        <div>
          <dt className="text-ink-400">Paid to you</dt>
          <dd className="tnum text-[15px] font-semibold text-ok-700">{sum(paid)}</dd>
        </div>
      </dl>
      <ul className="divide-y divide-line">
        {order.map((s) => {
          const label = (
            <>
              {s.commission.clientName ?? s.commission.number} <span className="text-ink-400">· {s.commission.institutionName}</span>
            </>
          );
          return (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
              <span className="min-w-0 text-ink-900">
                {commissionHref ? (
                  <Link href={commissionHref(s.commission.id)} className="hover:text-brand-700">
                    {label}
                  </Link>
                ) : (
                  label
                )}
              </span>
              <span className="flex items-center gap-2">
                <span className="tnum font-medium">{formatMoney(s.paidAmount ?? s.amount, s.currency)}</span>
                {s.paidOn ? (
                  <Pill tone="ok">Paid {formatDate(s.paidOn)}</Pill>
                ) : s.payable ? (
                  <Pill tone="warn">Due</Pill>
                ) : (
                  <Pill tone="neutral">{COMMISSION_STAGE_LABEL[s.commission.stage]}</Pill>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
