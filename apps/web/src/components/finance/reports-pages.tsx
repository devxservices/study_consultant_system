import Link from 'next/link';
import { notFound } from 'next/navigation';
import { localIsoDate, CURRENCIES, REPORTS, REPORT_DESCRIPTION, REPORT_LABEL, formatMoney, type AuthUser, type ReportName, type ReportView } from '@crm/shared';
import { apiFetch, qs } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { Card, PageHeader, cx } from '../ui';
import { NoAccess } from '../no-access';
import { FinanceTabs, pathsFor } from './workspace';

const PERIOD_REPORTS: ReportName[] = ['pnl', 'collections', 'revenue', 'tax', 'cash-flow'];

export async function ReportsIndexPage({ user }: { user: AuthUser }) {
  if (!can(user, 'finance.ledger')) return <NoAccess title="Reports" permission="finance.ledger" />;
  const p = pathsFor(user);
  const today = localIsoDate();
  const monthStart = `${today.slice(0, 7)}-01`;
  return (
    <>
      <PageHeader title="Reports" subtitle="All from the same books, so they always agree with each other." />
      <FinanceTabs user={user} active="reports" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((r) => (
          <Link key={r} href={`${p.base}/reports/${r}`} className="lift press block rounded-xl bg-paper p-4 shadow-card">
            <p className="text-[15px] font-medium text-ink-950">{REPORT_LABEL[r]}</p>
            <p className="mt-1 text-[12.5px] text-ink-500">{REPORT_DESCRIPTION[r]}</p>
          </Link>
        ))}
      </div>
      {can(user, 'data.export') && (
        <Card className="mt-6 p-4 sm:p-5">
          <h2 className="text-[15px] font-medium text-ink-950">Export the journal</h2>
          <p className="mb-3 mt-0.5 text-[12.5px] text-ink-500">For your accountant or accounting software: every entry and line in a period.</p>
          <form action="/api/finance/export/journal" className="flex flex-wrap items-end gap-2 text-[13px]">
            <label className="text-[11.5px] text-ink-500">
              From
              <input type="date" name="from" defaultValue={monthStart} className="block h-9 rounded-lg border border-line-strong bg-paper px-2.5" />
            </label>
            <label className="text-[11.5px] text-ink-500">
              To
              <input type="date" name="to" defaultValue={today} className="block h-9 rounded-lg border border-line-strong bg-paper px-2.5" />
            </label>
            <label className="text-[11.5px] text-ink-500">
              Format
              <select name="format" className="block h-9 rounded-lg border border-line-strong bg-paper px-2.5">
                <option value="csv">Spreadsheet (CSV)</option>
                <option value="xero">Xero manual journal (CSV)</option>
                <option value="quickbooks">QuickBooks Desktop (IIF)</option>
              </select>
            </label>
            <button className="h-9 rounded-lg bg-ink-900 px-3 font-medium text-paper">Download</button>
          </form>
        </Card>
      )}
    </>
  );
}

export async function ReportPage({ user, name, query }: { user: AuthUser; name: string; query: { from?: string; to?: string; currency?: string } }) {
  if (!can(user, 'finance.ledger')) return <NoAccess title="Reports" permission="finance.ledger" />;
  if (!(REPORTS as readonly string[]).includes(name)) notFound();
  const p = pathsFor(user);
  const r = await apiFetch<ReportView>(`/finance/reports/${name}${qs({ from: query.from, to: query.to, currency: query.currency })}`);
  const money = (v: number, i: number) => (r.moneyColumns.includes(i) ? formatMoney(v, r.currency === 'base' ? r.baseCurrency : r.currency) : String(v));
  const csv = `/api/finance/reports/${name}${qs({ from: query.from, to: query.to, currency: query.currency, format: 'csv' })}`;
  const period = PERIOD_REPORTS.includes(name as ReportName);
  return (
    <>
      <PageHeader title={r.title} subtitle={r.subtitle} breadcrumb={[{ href: `${p.base}/reports`, label: 'Reports' }, { label: r.title }]} actions={<a href={csv} className="inline-flex h-9.5 items-center rounded-lg border border-line-strong bg-paper px-3 text-[13.5px] font-medium text-ink-800 hover:bg-ink-50">Download CSV</a>} />
      <form className="mb-4 flex flex-wrap items-end gap-2 text-[13px]">
        {period && (
          <label className="text-[11.5px] text-ink-500">
            From
            <input type="date" name="from" defaultValue={r.from ?? ''} className="block h-9 rounded-lg border border-line-strong bg-paper px-2.5" />
          </label>
        )}
        {name !== 'aging' && name !== 'payables' && (
          <label className="text-[11.5px] text-ink-500">
            {period ? 'To' : 'As at'}
            <input type="date" name="to" defaultValue={r.to} className="block h-9 rounded-lg border border-line-strong bg-paper px-2.5" />
          </label>
        )}
        <label className="text-[11.5px] text-ink-500">
          Currency
          <select name="currency" defaultValue={query.currency ?? r.baseCurrency} className="block h-9 rounded-lg border border-line-strong bg-paper px-2.5">
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {!['aging', 'collections', 'tax', 'payables'].includes(name) && <option value="base">All, converted to {r.baseCurrency}</option>}
          </select>
        </label>
        <button className="h-9 rounded-lg bg-ink-900 px-3 font-medium text-paper">Run</button>
      </form>
      {r.checks.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {r.checks.map((c) => (
            <span key={c.label} className={cx('rounded-full px-2.5 py-1 text-[12px]', c.ok ? 'bg-ok-50 text-ok-700' : 'bg-bad-50 text-bad-700')}>
              {c.ok ? '✓' : '✕'} {c.label}
            </span>
          ))}
        </div>
      )}
      {r.unconverted > 0 && <p className="mb-3 text-[12.5px] text-warn-700">{r.unconverted} entries have no exchange rate and are left out of this converted report.</p>}
      <Card className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-ink-50 text-left text-[11.5px] uppercase tracking-wide text-ink-500">
            <tr>
              {r.columns.map((c, i) => (
                <th key={`${c}-${i}`} className={cx('whitespace-nowrap px-4 py-2 font-medium', r.moneyColumns.includes(i) && 'text-right')}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.rows.length === 0 ? (
              <tr>
                <td colSpan={r.columns.length} className="px-4 py-6 text-center text-ink-400">
                  Nothing in this period.
                </td>
              </tr>
            ) : (
              r.rows.map((row, i) => (
                <tr key={i} className={cx('border-t border-line', row.emphasis && 'bg-ink-50/60 font-semibold text-ink-950')}>
                  {row.values.map((v, j) => (
                    <td key={j} className={cx('whitespace-nowrap px-4 py-2', r.moneyColumns.includes(j) && 'tnum text-right', j === 0 && row.level ? 'pl-8' : '', typeof v === 'number' && v < 0 && 'text-bad-700')}>
                      {v === null || v === '' ? '' : typeof v === 'number' ? money(v, j) : j === 0 && row.accountId ? (
                        <Link href={`${p.base}/books/accounts/${row.accountId}${qs({ from: r.from ?? undefined, to: r.to })}`} className="hover:text-brand-700">
                          {v}
                        </Link>
                      ) : (
                        v
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
      <p className="mt-2 text-[12px] text-ink-400">Run on {formatDate(new Date().toISOString())}.</p>
    </>
  );
}
