import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMoney, type AuthUser, type BankAccountView, type DayCloseView, type FinanceSettingsView, type LedgerAccountView } from '@crm/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { Card, EmptyState, PageHeader, Panel, Pill, cx } from '../ui';
import { ActionButton } from '../forms';
import { NoAccess } from '../no-access';
import { FinanceTabs, MoneyTable, pathsFor } from './workspace';
import { CashCount, ImportStatement, MatchLine } from './bank-forms';

const SUBTYPE_LABEL = { cash: 'Cash', bank: 'Bank', clearing: 'Online' } as Record<string, string>;

export async function BankIndexPage({ user }: { user: AuthUser }) {
  if (!can(user, 'finance.ledger')) return <NoAccess title="Bank and cash" permission="finance.ledger" />;
  const p = pathsFor(user);
  const [accounts, closes, settings] = await Promise.all([
    apiFetch<LedgerAccountView[]>('/finance/accounts'),
    apiFetch<DayCloseView[]>('/finance/day-close'),
    apiFetch<FinanceSettingsView>('/finance/settings'),
  ]);
  const money = accounts.filter((a) => a.subtype === 'cash' || a.subtype === 'bank' || a.subtype === 'clearing');
  return (
    <>
      <PageHeader title="Bank and cash" subtitle="Reconcile each bank account against its statement; count the cash at the end of the day." />
      <FinanceTabs user={user} active="bank" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {money.map((a) => (
          <Link key={a.id} href={`${p.base}/bank/${a.id}`} className="lift press block rounded-xl bg-paper p-4 shadow-card">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[15px] font-medium text-ink-950">{a.name}</p>
              <Pill tone="neutral">{SUBTYPE_LABEL[a.subtype ?? ''] ?? a.subtype}</Pill>
            </div>
            <p className="tnum mt-2 text-[22px] font-semibold text-ink-950">
              {a.balances.length ? a.balances.map((b) => formatMoney(b.balance, b.currency)).join(' · ') : formatMoney(0, settings.baseCurrency)}
            </p>
            <p className="text-[12px] text-ink-400">{a.code} · in the books</p>
          </Link>
        ))}
      </div>
      <p className="mt-3 text-[12.5px] text-ink-400">
        Another bank account or wallet? Add it under{' '}
        <Link href={`${p.base}/books`} className="text-brand-700 hover:underline">
          Books
        </Link>{' '}
        as an asset of kind “bank”.
      </p>

      <div className="mt-6 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Count the cash" subtitle="Any difference is booked so the books match the drawer">
          <CashCount accounts={money.filter((a) => a.subtype === 'cash' || a.subtype === 'bank').map((a) => ({ id: a.id, name: a.name }))} baseCurrency={settings.baseCurrency} />
        </Panel>
        <Panel title="Days closed" bodyClassName="">
          {closes.length === 0 ? (
            <p className="px-4 pb-5 text-[13px] text-ink-400 sm:px-5">No cash counts yet.</p>
          ) : (
            <MoneyTable head={['Day', 'Account', { label: 'Books', right: true }, { label: 'Counted', right: true }, { label: 'Difference', right: true }]}>
              {closes.slice(0, 20).map((d) => (
                <tr key={d.id} className="border-t border-line">
                  <td className="tnum px-4 py-2 text-ink-600">{formatDate(d.date)}</td>
                  <td className="px-4 py-2 text-ink-800">
                    {d.accountName}
                    {d.closedByName && <span className="block text-[11.5px] text-ink-400">by {d.closedByName}</span>}
                  </td>
                  <td className="tnum px-4 py-2 text-right">{formatMoney(d.expected, d.currency)}</td>
                  <td className="tnum px-4 py-2 text-right">{formatMoney(d.counted, d.currency)}</td>
                  <td className={cx('tnum px-4 py-2 text-right font-medium', d.difference === 0 ? 'text-ok-700' : 'text-bad-700')}>{d.difference === 0 ? 'Exact' : formatMoney(d.difference, d.currency)}</td>
                </tr>
              ))}
            </MoneyTable>
          )}
        </Panel>
      </div>
    </>
  );
}

export async function BankAccountPage({ user, id, currency }: { user: AuthUser; id: string; currency?: string }) {
  if (!can(user, 'finance.ledger')) return <NoAccess title="Bank account" permission="finance.ledger" />;
  const p = pathsFor(user);
  let v: BankAccountView;
  try {
    v = await apiFetch<BankAccountView>(`/finance/bank/${id}${currency ? `?currency=${currency}` : ''}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const accounts = await apiFetch<LedgerAccountView[]>('/finance/account-options');
  const others = accounts.filter((a) => a.active && a.id !== id).map((a) => ({ id: a.id, name: `${a.code} ${a.name}` }));
  const difference = v.statementTotal - v.reconciledBalance;
  return (
    <>
      <PageHeader
        title={v.account.name}
        subtitle={`${v.account.code} · reconciling in ${v.currency}`}
        breadcrumb={[{ href: `${p.base}/bank`, label: 'Bank and cash' }, { label: v.account.name }]}
        actions={
          <>
            <Link href={`${p.base}/books/accounts/${id}`} className="inline-flex h-9.5 items-center rounded-lg px-3 text-[13.5px] font-medium text-ink-700 hover:bg-ink-50">
              Ledger
            </Link>
            <ImportStatement accountId={id} />
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-[12px] text-ink-500">In the books</p>
          <p className="tnum mt-1 text-[22px] font-semibold text-ink-950">{formatMoney(v.ledgerBalance, v.currency)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[12px] text-ink-500">Matched to the statement</p>
          <p className="tnum mt-1 text-[22px] font-semibold text-ink-950">{formatMoney(v.reconciledBalance, v.currency)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[12px] text-ink-500">Statement lines imported</p>
          <p className="tnum mt-1 text-[22px] font-semibold text-ink-950">{formatMoney(v.statementTotal, v.currency)}</p>
          <p className={cx('text-[12px]', difference === 0 ? 'text-ok-700' : 'text-warn-700')}>{difference === 0 ? 'Fully reconciled' : `${formatMoney(difference, v.currency)} not yet matched`}</p>
        </Card>
      </div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel title={`On the statement, not yet matched (${v.unmatchedBank.length})`} bodyClassName="">
          {v.unmatchedBank.length === 0 ? (
            <EmptyState compact title="Nothing to match" description="Import a statement to reconcile it line by line." />
          ) : (
            <ul className="divide-y divide-line">
              {v.unmatchedBank.map((l) => (
                <li key={l.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,21rem)] sm:px-5">
                  <div className="min-w-0">
                    <p className={cx('tnum text-[15px] font-semibold', l.amount < 0 ? 'text-bad-700' : 'text-ok-700')}>
                      {l.amount < 0 ? '−' : '+'}
                      {formatMoney(Math.abs(l.amount), v.currency)}
                    </p>
                    <p className="text-[12.5px] text-ink-700">{l.description}</p>
                    <p className="text-[12px] text-ink-400">
                      {formatDate(l.lineDate)}
                      {l.reference ? ` · ${l.reference}` : ''}
                    </p>
                  </div>
                  <MatchLine lineId={l.id} amount={l.amount} currency={v.currency} suggestions={v.suggestions[l.id] ?? []} candidates={v.unmatchedLedger} accounts={others} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="space-y-5">
          <Panel title={`In the books, not on a statement (${v.unmatchedLedger.length})`} subtitle="Usually money not yet cleared, or a statement not yet imported" bodyClassName="">
            {v.unmatchedLedger.length === 0 ? (
              <p className="px-4 pb-5 text-[13px] text-ink-400 sm:px-5">Everything is matched.</p>
            ) : (
              <ul className="max-h-96 divide-y divide-line overflow-y-auto">
                {v.unmatchedLedger.slice(0, 100).map((l) => (
                  <li key={l.lineId} className="flex items-center justify-between gap-3 px-4 py-2 text-[12.5px] sm:px-5">
                    <span className="min-w-0 truncate text-ink-700">
                      {formatDate(l.entryDate)} · {l.memo}
                    </span>
                    <span className={cx('tnum shrink-0 font-medium', l.amount < 0 ? 'text-bad-700' : 'text-ok-700')}>{formatMoney(l.amount, v.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {v.matched.length > 0 && (
            <Panel title="Matched recently" bodyClassName="">
              <ul className="divide-y divide-line">
                {v.matched.slice(0, 15).map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2 text-[12.5px] sm:px-5">
                    <span className="min-w-0 truncate text-ink-700">
                      {formatDate(l.lineDate)} · {l.description} → {l.matchedEntryNumber}
                    </span>
                    <ActionButton url={`/api/finance/bank/lines/${l.id}/unmatch`} variant="ghost">
                      Unmatch
                    </ActionButton>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {v.imports.length > 0 && (
            <Panel title="Imports" bodyClassName="">
              <ul className="divide-y divide-line">
                {v.imports.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-2 text-[12.5px] sm:px-5">
                    <span className="min-w-0 truncate text-ink-700">
                      {i.fileName} · {i.lineCount} lines · {formatDate(i.createdAt)}
                      {i.importedByName ? ` · ${i.importedByName}` : ''}
                    </span>
                    <ActionButton url={`/api/finance/bank/imports/${i.id}`} method="DELETE" variant="ghost" confirm="Remove this import and its unmatched lines?">
                      Remove
                    </ActionButton>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
