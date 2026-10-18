import Link from 'next/link';
import { PAYMENT_METHOD_LABEL, formatMoney, type AuthUser, type BillView, type ExpenseView, type FinanceSettingsView, type LedgerAccountView, type Paginated } from '@crm/shared';
import { apiFetch, qs } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { Card, EmptyState, PageHeader, Pill, cx } from '../ui';
import { ReasonAction } from '../forms';
import { NoAccess } from '../no-access';
import { Pagination } from '../client-table';
import { FinanceTabs, MoneyTable, pathsFor } from './workspace';
import { ExpenseButton, NewBillButton, PayBillButton } from './spending-forms';

async function options() {
  const [accounts, settings] = await Promise.all([apiFetch<LedgerAccountView[]>('/finance/account-options'), apiFetch<FinanceSettingsView>('/finance/settings')]);
  const live = accounts.filter((a) => a.active);
  return {
    baseCurrency: settings.baseCurrency,
    headings: live.filter((a) => a.type === 'expense' || a.systemKey === 'disbursements' || a.systemKey === 'partner_advances').map((a) => ({ id: a.id, name: `${a.code} ${a.name}` })),
    money: live.filter((a) => a.subtype === 'cash' || a.subtype === 'bank' || a.subtype === 'clearing').map((a) => ({ id: a.id, name: a.name })),
  };
}

export async function ExpensesPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!can(user, 'finance.expenses')) return <NoAccess title="Expenses" permission="finance.expenses" />;
  const p = pathsFor(user);
  const pageNo = Math.max(1, Number(query.page) || 1);
  const [list, opts] = await Promise.all([
    apiFetch<Paginated<ExpenseView>>(`/finance/expenses${qs({ page: pageNo, q: query.q, from: query.from, to: query.to, accountId: query.accountId })}`),
    options(),
  ]);
  const href = (x: Record<string, string | number | undefined>) => `${p.base}/expenses${qs({ q: query.q, from: query.from, to: query.to, accountId: query.accountId, ...x })}`;
  return (
    <>
      <PageHeader title="Expenses" subtitle="What the consultancy spends, booked to its heading as it is paid." actions={<ExpenseButton headings={opts.headings} moneyAccounts={opts.money} baseCurrency={opts.baseCurrency} startOpen={query.new === '1'} />} />
      <FinanceTabs user={user} active="expenses" />
      <form action={`${p.base}/expenses`} className="mb-3 flex flex-wrap items-end gap-2 text-[13px]">
        <input name="q" defaultValue={query.q} placeholder="Supplier, description or number" className="h-9 w-64 rounded-lg border border-line-strong bg-paper px-2.5" />
        <input type="date" name="from" defaultValue={query.from} className="h-9 rounded-lg border border-line-strong bg-paper px-2.5" />
        <input type="date" name="to" defaultValue={query.to} className="h-9 rounded-lg border border-line-strong bg-paper px-2.5" />
        <select name="accountId" defaultValue={query.accountId ?? ''} className="h-9 rounded-lg border border-line-strong bg-paper px-2.5">
          <option value="">Every heading</option>
          {opts.headings.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
        <button className="h-9 rounded-lg bg-ink-900 px-3 font-medium text-paper">Filter</button>
      </form>
      <Card className="overflow-hidden">
        {list.items.length === 0 ? (
          <EmptyState title="No expenses recorded" description="Rent, salaries, marketing, fees paid for students - record them as they are paid." />
        ) : (
          <MoneyTable head={['Date', 'Number', 'Paid to', 'Heading', 'From', { label: 'Amount', right: true }, '']}>
            {list.items.map((e) => (
              <tr key={e.id} className={cx('border-t border-line align-top', e.voided && 'opacity-60')}>
                <td className="tnum whitespace-nowrap px-4 py-2.5 text-ink-500">{formatDate(e.spentOn)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12.5px] text-ink-700">{e.number}</td>
                <td className="px-4 py-2.5 text-ink-900">
                  {e.vendor}
                  <span className="block text-[12px] text-ink-500">{e.description}</span>
                  {e.clientName && <span className="block text-[12px] text-ink-400">for {e.clientName}</span>}
                  {e.hasReceipt && (
                    <a href={`/api/finance/expenses/${e.id}/receipt`} target="_blank" rel="noreferrer" className="text-[12px] text-brand-700 hover:underline">
                      Receipt ↗
                    </a>
                  )}
                  {e.voided && <span className="block text-[12px] text-bad-700">Void: {e.voidReason}</span>}
                </td>
                <td className="px-4 py-2.5 text-ink-600">{e.accountName}</td>
                <td className="px-4 py-2.5 text-ink-600">
                  {e.paidFromName}
                  <span className="block text-[12px] text-ink-400">{PAYMENT_METHOD_LABEL[e.method]}</span>
                </td>
                <td className={cx('tnum whitespace-nowrap px-4 py-2.5 text-right font-semibold', e.voided ? 'text-ink-400 line-through' : 'text-ink-950')}>{formatMoney(e.amount, e.currency)}</td>
                <td className="px-4 py-2.5 text-right">
                  {!e.voided && <ReasonAction label="Void" confirmLabel="Void expense" url={`/api/finance/expenses/${e.id}/void`} explanation="It stays on record marked void, and the books are reversed." placeholder="e.g. Recorded twice" />}
                </td>
              </tr>
            ))}
          </MoneyTable>
        )}
      </Card>
      <Pagination data={list} buildHref={(n) => href({ page: n })} />
    </>
  );
}

export async function BillsPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!can(user, 'finance.expenses')) return <NoAccess title="Bills" permission="finance.expenses" />;
  const p = pathsFor(user);
  const status = ['open', 'overdue', 'paid', 'void', 'all'].includes(query.status ?? '') ? query.status! : 'open';
  const [bills, opts] = await Promise.all([apiFetch<BillView[]>(`/finance/bills${qs({ status, q: query.q })}`), options()]);
  return (
    <>
      <PageHeader title="Bills" subtitle="What the consultancy owes suppliers, and when." actions={<NewBillButton headings={opts.headings} baseCurrency={opts.baseCurrency} />} />
      <FinanceTabs user={user} active="bills" />
      <div className="mb-3 flex flex-wrap gap-1.5 text-[12.5px]">
        {[
          ['open', 'To pay'],
          ['overdue', 'Overdue'],
          ['paid', 'Paid'],
          ['void', 'Void'],
          ['all', 'All'],
        ].map(([k, label]) => (
          <Link key={k} href={`${p.base}/bills${qs({ status: k })}`} className={cx('rounded-full px-2.5 py-1 ring-1', status === k ? 'bg-ink-900 text-paper ring-ink-900' : 'text-ink-600 ring-line hover:bg-ink-50')}>
            {label}
          </Link>
        ))}
      </div>
      <Card className="overflow-hidden">
        {bills.length === 0 ? (
          <EmptyState title="No bills here" description="Add a supplier’s bill when it arrives; pay it from here when it is due." />
        ) : (
          <MoneyTable head={['Due', 'Bill', 'Supplier', 'Heading', 'Status', { label: 'Amount', right: true }, '']}>
            {bills.map((b) => (
              <tr key={b.id} className="border-t border-line align-top">
                <td className={cx('tnum whitespace-nowrap px-4 py-2.5', b.overdue ? 'font-medium text-bad-700' : 'text-ink-500')}>{formatDate(b.dueDate)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12.5px] text-ink-700">
                  {b.number}
                  {b.vendorReference && <span className="block font-sans text-[11.5px] text-ink-400">#{b.vendorReference}</span>}
                </td>
                <td className="px-4 py-2.5 text-ink-900">
                  {b.vendor}
                  <span className="block text-[12px] text-ink-500">{b.description}</span>
                </td>
                <td className="px-4 py-2.5 text-ink-600">{b.accountName}</td>
                <td className="px-4 py-2.5">
                  <Pill tone={b.status === 'paid' ? 'ok' : b.status === 'void' ? 'neutral' : b.overdue ? 'bad' : 'warn'}>
                    {b.status === 'paid' ? `Paid ${b.paidOn ? formatDate(b.paidOn) : ''}` : b.status === 'void' ? 'Void' : b.overdue ? 'Overdue' : 'To pay'}
                  </Pill>
                </td>
                <td className="tnum whitespace-nowrap px-4 py-2.5 text-right font-semibold text-ink-950">{formatMoney(b.amount, b.currency)}</td>
                <td className="min-w-[13rem] px-4 py-2.5 text-right">
                  {b.status === 'open' && (
                    <div className="flex flex-col items-end gap-1.5">
                      <PayBillButton billId={b.id} moneyAccounts={opts.money} />
                      <ReasonAction label="Void" confirmLabel="Void bill" url={`/api/finance/bills/${b.id}/void`} explanation="For a bill entered by mistake." placeholder="e.g. Duplicate" />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </MoneyTable>
        )}
      </Card>
    </>
  );
}
