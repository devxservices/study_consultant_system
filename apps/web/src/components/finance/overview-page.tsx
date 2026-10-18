import Link from 'next/link';
import { JOURNAL_SOURCE_LABEL, formatMoney, type AuthUser, type FinanceOverview } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Card, EmptyState, LinkButton, PageHeader, Panel, StatCard, cx } from '../ui';
import { IconAlert, IconCheck, IconClock, IconPlus, IconWallet } from '../icons';
import { FinanceTabs, MoneyTable, financeAccess, pathsFor } from './workspace';

const BUCKETS = [
  { key: 'current', label: 'Not yet due' },
  { key: 'd1_30', label: '1–30 days late' },
  { key: 'd31_60', label: '31–60' },
  { key: 'd61_90', label: '61–90' },
  { key: 'd90plus', label: 'Over 90' },
] as const;

/**
 * The accountant's front page: what is in the bank and the drawer, what
 * students owe and how late, what is due to suppliers, how the month is
 * going, and the queues waiting on someone.
 */
export async function FinanceOverviewPage({ user }: { user: AuthUser }) {
  const p = pathsFor(user);
  const a = financeAccess(user);
  const o = await apiFetch<FinanceOverview>('/finance/overview');
  const main = o.receivables.find((r) => r.currency === o.baseCurrency) ?? o.receivables[0];
  const month = o.thisMonth.find((m) => m.currency === o.baseCurrency);
  const queues = [
    { show: a.verify, n: o.queues.proofsToVerify, label: plural(o.queues.proofsToVerify, 'payment proof to check', 'payment proofs to check'), href: `${p.base}/verify` },
    { show: a.approve, n: o.queues.refundsToApprove, label: plural(o.queues.refundsToApprove, 'refund to approve', 'refunds to approve'), href: `${p.base}/approvals` },
    { show: a.approve, n: o.queues.invoicesToApprove, label: plural(o.queues.invoicesToApprove, 'discounted invoice to approve', 'discounted invoices to approve'), href: `${p.base}/approvals` },
    { show: a.expenses, n: o.queues.billsOverdue, label: plural(o.queues.billsOverdue, 'bill overdue', 'bills overdue'), href: `${p.base}/bills?status=overdue` },
    { show: a.ledger, n: o.queues.unmatchedBankLines, label: plural(o.queues.unmatchedBankLines, 'bank line to reconcile', 'bank lines to reconcile'), href: `${p.base}/bank` },
  ].filter((q) => q.show);

  return (
    <>
      <PageHeader
        title="Finance"
        subtitle={`The books in ${o.baseCurrency}${o.lockedThrough ? ` · closed up to ${formatDate(o.lockedThrough)}` : ''}.`}
        actions={
          <>
            {a.expenses && (
              <LinkButton href={`${p.base}/expenses?new=1`} variant="secondary">
                Record expense
              </LinkButton>
            )}
            {a.invoice && (
              <LinkButton href={p.newInvoice}>
                <IconPlus size={16} />
                New invoice
              </LinkButton>
            )}
          </>
        }
      />
      <FinanceTabs user={user} active="overview" counts={{ verify: o.queues.proofsToVerify, approvals: o.queues.refundsToApprove + o.queues.invoicesToApprove }} />

      {queues.some((q) => q.n > 0) && (
        <Card className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 p-4">
          <IconAlert size={18} className="text-warn-600" />
          {queues
            .filter((q) => q.n > 0)
            .map((q) => (
              <Link key={q.label} href={q.href} className="text-[13.5px] text-ink-800 hover:text-brand-700">
                <span className="tnum font-semibold">{q.n}</span> {q.label}
              </Link>
            ))}
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Students owe" value={formatMoney(main?.total ?? 0, main?.currency ?? o.baseCurrency)} icon={<IconWallet size={18} />} tone="info" href={p.invoices + '?status=open'} hint="issued and not yet paid" />
        <StatCard
          label="Of which late"
          value={formatMoney((main?.total ?? 0) - (main?.current ?? 0), main?.currency ?? o.baseCurrency)}
          icon={<IconClock size={18} />}
          tone={(main?.total ?? 0) - (main?.current ?? 0) > 0 ? 'bad' : 'neutral'}
          href={p.invoices + '?status=overdue'}
          hint="past a due date"
        />
        {month ? (
          <>
            <StatCard label="Income this month" value={formatMoney(month.income, month.currency)} icon={<IconCheck size={18} />} tone="ok" hint="from the books" />
            <StatCard
              label={month.profit >= 0 ? 'Profit this month' : 'Loss this month'}
              value={formatMoney(month.profit, month.currency)}
              icon={<IconWallet size={18} />}
              tone={month.profit >= 0 ? 'ok' : 'bad'}
              hint={`after ${formatMoney(month.expenses, month.currency)} of expenses`}
            />
          </>
        ) : (
          <Card className="p-4 sm:col-span-2">
            <p className="text-[13px] text-ink-500">Nothing booked yet this month.</p>
          </Card>
        )}
      </div>

      <div className="mt-5 grid items-start gap-5">
        <Panel title="What students owe, by lateness" subtitle="Installment by installment" bodyClassName="">
          {o.receivables.every((r) => r.total === 0) ? (
            <p className="px-4 pb-5 text-[13px] text-ink-400 sm:px-5">Nothing is owed.</p>
          ) : (
            <MoneyTable head={['Currency', ...BUCKETS.map((b) => ({ label: b.label, right: true })), { label: 'Total', right: true }]}>
              {o.receivables.map((r) => (
                <tr key={r.currency} className="border-t border-line">
                  <td className="px-4 py-2.5 font-medium text-ink-900">{r.currency}</td>
                  {BUCKETS.map((b) => (
                    <td key={b.key} className={cx('tnum px-4 py-2.5 text-right', b.key !== 'current' && r[b.key] > 0 ? 'text-bad-700' : 'text-ink-700')}>
                      {r[b.key] ? formatMoney(r[b.key], r.currency) : '–'}
                    </td>
                  ))}
                  <td className="tnum px-4 py-2.5 text-right font-semibold text-ink-950">{formatMoney(r.total, r.currency)}</td>
                </tr>
              ))}
            </MoneyTable>
          )}
          {a.ledger && (
            <p className="px-4 py-3 text-[12px] text-ink-400 sm:px-5">
              <Link href={`${p.base}/reports/aging`} className="text-brand-700 hover:underline">
                By student
              </Link>{' '}
              · always equal to Accounts receivable in the books.
            </p>
          )}
        </Panel>

        <div className="grid items-start gap-5 xl:grid-cols-2">
          {a.ledger && (
            <Panel title="Money held" subtitle="Cash, bank and online accounts" bodyClassName="pb-2">
              <ul className="divide-y divide-line">
                {o.money.map((m) => (
                  <li key={m.accountId}>
                    <Link href={`${p.base}/bank/${m.accountId}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-ink-50 sm:px-5">
                      <span className="text-[13.5px] text-ink-800">{m.name}</span>
                      <span className="tnum text-right text-[13.5px] font-semibold text-ink-950">
                        {m.balances.length ? m.balances.map((b) => formatMoney(b.balance, b.currency)).join(' · ') : formatMoney(0, o.baseCurrency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {a.expenses && (
            <Panel title="Bills to pay" bodyClassName="px-4 pb-4 sm:px-5">
              {o.payablesDue.length === 0 ? (
                <p className="text-[13px] text-ink-400">No unpaid bills.</p>
              ) : (
                o.payablesDue.map((pd) => (
                  <p key={pd.currency} className="text-[13.5px] text-ink-700">
                    <span className="tnum font-semibold text-ink-950">{formatMoney(pd.open, pd.currency)}</span> open
                    {pd.overdue ? (
                      <span className="text-bad-700">
                        {' '}
                        · <span className="tnum font-semibold">{formatMoney(pd.overdue, pd.currency)}</span> overdue
                      </span>
                    ) : null}
                  </p>
                ))
              )}
            </Panel>
          )}
        </div>
      </div>

      {a.ledger && (
        <Panel title="Latest entries" className="mt-5" bodyClassName="" action={<LinkButton href={`${p.base}/books/journal`} variant="secondary" size="sm">Journal</LinkButton>}>
          {o.recentEntries.length === 0 ? (
            <EmptyState title="Nothing posted yet" description="Invoices, payments and expenses post here as they are recorded." />
          ) : (
            <MoneyTable head={['Date', 'Entry', 'What', { label: 'Amount', right: true }]}>
              {o.recentEntries.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="tnum whitespace-nowrap px-4 py-2.5 text-ink-500">{formatDate(e.entryDate)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12.5px] text-ink-700">{e.number}</td>
                  <td className="px-4 py-2.5 text-ink-800">
                    {e.memo} <span className="text-ink-400">· {JOURNAL_SOURCE_LABEL[e.sourceType]}</span>
                  </td>
                  <td className="tnum whitespace-nowrap px-4 py-2.5 text-right text-ink-900">{formatMoney(e.total, e.currency)}</td>
                </tr>
              ))}
            </MoneyTable>
          )}
        </Panel>
      )}
    </>
  );
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
