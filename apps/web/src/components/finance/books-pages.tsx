import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABEL,
  JOURNAL_SOURCES,
  JOURNAL_SOURCE_LABEL,
  formatMoney,
  type AuthUser,
  type FinanceSettingsView,
  type GeneralLedgerView,
  type JournalEntryView,
  type LedgerAccountView,
  type Paginated,
} from '@crm/shared';
import { ApiError, apiFetch, qs } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { Card, EmptyState, PageHeader, Panel, Pill, cx } from '../ui';
import { ReasonAction } from '../forms';
import { NoAccess } from '../no-access';
import { Pagination } from '../client-table';
import { FinanceTabs, MoneyTable, pathsFor } from './workspace';
import { AccountButton, ManualEntryButton, PeriodLock } from './books-forms';

function BooksNav({ base, active }: { base: string; active: 'accounts' | 'journal' }) {
  return (
    <div className="mb-4 flex gap-1.5 text-[12.5px]">
      {[
        ['accounts', 'Chart of accounts', `${base}/books`],
        ['journal', 'Journal', `${base}/books/journal`],
      ].map(([k, label, href]) => (
        <Link key={k} href={href!} className={cx('rounded-full px-2.5 py-1 ring-1', active === k ? 'bg-ink-900 text-paper ring-ink-900' : 'text-ink-600 ring-line hover:bg-ink-50')}>
          {label}
        </Link>
      ))}
    </div>
  );
}

export async function ChartOfAccountsPage({ user }: { user: AuthUser }) {
  if (!can(user, 'finance.ledger')) return <NoAccess title="Books" permission="finance.ledger" />;
  const p = pathsFor(user);
  const [accounts, settings] = await Promise.all([apiFetch<LedgerAccountView[]>('/finance/accounts?all=true'), apiFetch<FinanceSettingsView>('/finance/settings')]);
  return (
    <>
      <PageHeader title="Books" subtitle="Every account the consultancy’s money moves through, with its balance today." actions={<AccountButton />} />
      <FinanceTabs user={user} active="books" />
      <BooksNav base={p.base} active="accounts" />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {ACCOUNT_TYPES.map((type) => {
            const rows = accounts.filter((a) => a.type === type);
            if (!rows.length) return null;
            return (
              <Panel key={type} title={ACCOUNT_TYPE_LABEL[type]} bodyClassName="">
                <MoneyTable head={['Code', 'Account', { label: 'Balance', right: true }, '']}>
                  {rows.map((a) => (
                    <tr key={a.id} className={cx('border-t border-line', !a.active && 'opacity-50')}>
                      <td className="tnum px-4 py-2 font-mono text-[12.5px] text-ink-500">{a.code}</td>
                      <td className="px-4 py-2">
                        <Link href={`${p.base}/books/accounts/${a.id}`} className="font-medium text-ink-900 hover:text-brand-700">
                          {a.name}
                        </Link>
                        {a.description && <span className="block text-[11.5px] text-ink-400">{a.description}</span>}
                      </td>
                      <td className="tnum whitespace-nowrap px-4 py-2 text-right text-ink-900">{a.balances.length ? a.balances.map((b) => formatMoney(b.balance, b.currency)).join(' · ') : '–'}</td>
                      <td className="px-4 py-2 text-right">
                        <AccountButton account={a} />
                      </td>
                    </tr>
                  ))}
                </MoneyTable>
              </Panel>
            );
          })}
        </div>
        <div className="space-y-5">
          <Panel title="Closing a period">
            <PeriodLock lockedThrough={settings.lockedThrough} canReopen={user.role === 'manager'} />
            <p className="mt-3 text-[12px] leading-relaxed text-ink-400">
              Month end: once a month is reconciled and reported, close it so nothing can be added to it. A correction found later is dated today. Only a manager can reopen a closed period.
            </p>
          </Panel>
          <Card className="p-4 text-[12.5px] leading-relaxed text-ink-500">
            Every invoice, payment, credit note, expense and bill posts here as it happens, in the same transaction - the books and the documents cannot disagree. Entries are never edited; a mistake is reversed.
          </Card>
        </div>
      </div>
    </>
  );
}

export async function AccountLedgerPage({ user, id, query }: { user: AuthUser; id: string; query: { from?: string; to?: string; currency?: string } }) {
  if (!can(user, 'finance.ledger')) return <NoAccess title="Ledger" permission="finance.ledger" />;
  const p = pathsFor(user);
  let gl: GeneralLedgerView;
  try {
    gl = await apiFetch<GeneralLedgerView>(`/finance/accounts/${id}/ledger${qs({ from: query.from, to: query.to, currency: query.currency })}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  return (
    <>
      <PageHeader
        title={`${gl.account.code} ${gl.account.name}`}
        subtitle={`${ACCOUNT_TYPE_LABEL[gl.account.type]} · ${gl.currency} · ${formatDate(gl.from)} to ${formatDate(gl.to)}`}
        breadcrumb={[{ href: `${p.base}/books`, label: 'Books' }, { label: gl.account.name }]}
      />
      <form className="mb-3 flex flex-wrap items-end gap-2 text-[13px]">
        <input type="date" name="from" defaultValue={gl.from} className="h-9 rounded-lg border border-line-strong bg-paper px-2.5" />
        <input type="date" name="to" defaultValue={gl.to} className="h-9 rounded-lg border border-line-strong bg-paper px-2.5" />
        <input name="currency" defaultValue={gl.currency} className="h-9 w-20 rounded-lg border border-line-strong bg-paper px-2.5 uppercase" />
        <button className="h-9 rounded-lg bg-ink-900 px-3 font-medium text-paper">Show</button>
      </form>
      <Card className="overflow-hidden">
        <MoneyTable head={['Date', 'Entry', 'What', { label: 'Debit', right: true }, { label: 'Credit', right: true }, { label: 'Balance', right: true }]}>
          <tr className="border-t border-line bg-ink-50/50">
            <td className="px-4 py-2 text-ink-500" colSpan={5}>
              Brought forward
            </td>
            <td className="tnum px-4 py-2 text-right font-medium">{formatMoney(gl.opening, gl.currency)}</td>
          </tr>
          {gl.rows.map((r) => (
            <tr key={r.lineId} className="border-t border-line">
              <td className="tnum whitespace-nowrap px-4 py-2 text-ink-500">{formatDate(r.entryDate)}</td>
              <td className="whitespace-nowrap px-4 py-2 font-mono text-[12px] text-ink-600">
                {r.entryNumber}
                {r.reconciled && <span className="ml-1 text-ok-600" title="Matched to the bank statement">✓</span>}
              </td>
              <td className="px-4 py-2 text-ink-800">
                {r.memo}
                <span className="block text-[11.5px] text-ink-400">{JOURNAL_SOURCE_LABEL[r.sourceType]}</span>
              </td>
              <td className="tnum px-4 py-2 text-right">{r.debit ? formatMoney(r.debit, gl.currency) : ''}</td>
              <td className="tnum px-4 py-2 text-right">{r.credit ? formatMoney(r.credit, gl.currency) : ''}</td>
              <td className="tnum px-4 py-2 text-right font-medium">{formatMoney(r.running, gl.currency)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-line">
            <td className="px-4 py-2 font-semibold text-ink-900" colSpan={5}>
              Carried forward
            </td>
            <td className="tnum px-4 py-2 text-right font-semibold">{formatMoney(gl.closing, gl.currency)}</td>
          </tr>
        </MoneyTable>
      </Card>
      {gl.truncated && <p className="mt-2 text-[12.5px] text-warn-700">Showing the first 1,000 lines; narrow the dates to see the rest.</p>}
    </>
  );
}

export async function JournalPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!can(user, 'finance.ledger')) return <NoAccess title="Journal" permission="finance.ledger" />;
  const p = pathsFor(user);
  const page = Math.max(1, Number(query.page) || 1);
  const [journal, accounts, settings] = await Promise.all([
    apiFetch<Paginated<JournalEntryView>>(`/finance/journal${qs({ page, pageSize: 25, from: query.from, to: query.to, sourceType: query.sourceType, q: query.q, accountId: query.accountId })}`),
    apiFetch<LedgerAccountView[]>('/finance/account-options'),
    apiFetch<FinanceSettingsView>('/finance/settings'),
  ]);
  const options = accounts.filter((a) => a.active).map((a) => ({ id: a.id, name: `${a.code} ${a.name}` }));
  const href = (x: Record<string, string | number | undefined>) => `${p.base}/books/journal${qs({ from: query.from, to: query.to, sourceType: query.sourceType, q: query.q, accountId: query.accountId, ...x })}`;
  return (
    <>
      <PageHeader title="Books" subtitle="Every entry, newest first. Nothing here is ever edited; a mistake is reversed." actions={<ManualEntryButton accounts={options} baseCurrency={settings.baseCurrency} />} />
      <FinanceTabs user={user} active="books" />
      <BooksNav base={p.base} active="journal" />
      <form action={`${p.base}/books/journal`} className="mb-3 flex flex-wrap items-end gap-2 text-[13px]">
        <input name="q" defaultValue={query.q} placeholder="Memo or entry number" className="h-9 w-56 rounded-lg border border-line-strong bg-paper px-2.5" />
        <input type="date" name="from" defaultValue={query.from} className="h-9 rounded-lg border border-line-strong bg-paper px-2.5" />
        <input type="date" name="to" defaultValue={query.to} className="h-9 rounded-lg border border-line-strong bg-paper px-2.5" />
        <select name="sourceType" defaultValue={query.sourceType ?? ''} className="h-9 rounded-lg border border-line-strong bg-paper px-2.5">
          <option value="">Everything</option>
          {JOURNAL_SOURCES.map((s) => (
            <option key={s} value={s}>
              {JOURNAL_SOURCE_LABEL[s]}
            </option>
          ))}
        </select>
        <select name="accountId" defaultValue={query.accountId ?? ''} className="h-9 rounded-lg border border-line-strong bg-paper px-2.5">
          <option value="">Any account</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <button className="h-9 rounded-lg bg-ink-900 px-3 font-medium text-paper">Filter</button>
      </form>
      {journal.items.length === 0 ? (
        <Card>
          <EmptyState title="No entries" description="Nothing matches. Entries appear as invoices, payments and expenses are recorded." />
        </Card>
      ) : (
        <div className="space-y-2">
          {journal.items.map((e) => (
            <Card key={e.id} className="overflow-hidden">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3 sm:px-5">
                <span className="font-mono text-[12.5px] font-medium text-ink-900">{e.number}</span>
                <span className="tnum text-[12.5px] text-ink-500">{formatDate(e.entryDate)}</span>
                <span className="min-w-0 flex-1 text-[13.5px] text-ink-900">{e.memo}</span>
                <Pill tone="neutral">{JOURNAL_SOURCE_LABEL[e.sourceType]}</Pill>
                {e.reversedById && <Pill tone="warn">Reversed</Pill>}
                {e.reversalOfId && <Pill tone="info">Reversal</Pill>}
              </div>
              <table className="mt-2 w-full text-[12.5px]">
                <tbody>
                  {e.lines.map((l) => (
                    <tr key={l.id} className="border-t border-line">
                      <td className={cx('px-4 py-1.5 sm:px-5', l.credit ? 'pl-10 sm:pl-12' : '')}>
                        <span className="font-mono text-ink-400">{l.accountCode}</span> <span className="text-ink-800">{l.accountName}</span>
                        {l.clientName && <span className="text-ink-400"> · {l.clientName}</span>}
                      </td>
                      <td className="tnum w-32 px-4 py-1.5 text-right">{l.debit ? formatMoney(l.debit, e.currency) : ''}</td>
                      <td className="tnum w-32 px-4 py-1.5 text-right sm:pr-5">{l.credit ? formatMoney(l.credit, e.currency) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(e.sourceType === 'manual' || e.sourceType === 'bank') && !e.reversedById && !e.reversalOfId && (
                <div className="border-t border-line px-4 py-2 sm:px-5">
                  <ReasonAction label="Reverse" confirmLabel="Post the reversal" url={`/api/finance/journal/${e.id}/reverse`} explanation="Posts the mirror image today. The original stays." placeholder="e.g. Posted to the wrong account" />
                </div>
              )}
              <p className="px-4 pb-2 text-[11.5px] text-ink-400 sm:px-5">{e.createdByName ? `by ${e.createdByName}` : 'by the system'}</p>
            </Card>
          ))}
        </div>
      )}
      <Pagination data={journal} buildHref={(n) => href({ page: n })} />
    </>
  );
}
