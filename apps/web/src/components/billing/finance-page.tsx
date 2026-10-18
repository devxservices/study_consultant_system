import Link from 'next/link';
import {
  formatMoney,
  type BillingTotals,
  type InvoiceSummaryView,
  type Paginated,
  type PaymentView,
  type AuthUser,
} from '@crm/shared';
import { apiFetch, qs } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Card, LinkButton, PageHeader, Panel, StatCard, cx } from '../ui';
import { IconAlert, IconCheck, IconClock, IconPlus, IconWallet } from '../icons';
import { BarChart } from '../charts/bar-chart';
import { Pagination } from '../client-table';
import { InvoiceTable } from './invoice-table';
import { FinanceTabs, hasWorkspace } from '../finance/workspace';

export interface FinancePaths {
  list: string;
  invoice: string;
  receipt: string;
  newInvoice: string;
  packages?: string;
  quotes?: string;
}

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Unpaid' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid', label: 'Paid' },
  { key: 'pending', label: 'Awaiting approval' },
  { key: 'void', label: 'Void' },
] as const;

/**
 * Money in, money owed. A manager sees the whole consultancy; a consultant the
 * same page for their own clients. Figures are per currency and headline the
 * consultancy's main one - rupees and pounds are never added together.
 */
export async function FinancePage({
  manager,
  canInvoice = true,
  paths,
  searchParams,
  user,
}: {
  /** For the workspace tabs, when this person has the finance workspace. */
  user?: AuthUser;
  manager: boolean;
  /** May issue invoices - hides "New invoice" when not. */
  canInvoice?: boolean;
  paths: FinancePaths;
  searchParams: Record<string, string | undefined>;
}) {
  const status = TABS.some((t) => t.key === searchParams.status) ? searchParams.status! : 'all';
  const q = searchParams.q?.trim() || undefined;
  const page = Number(searchParams.page) || 1;

  const [totals, revenue, invoices, recent] = await Promise.all([
    apiFetch<BillingTotals[]>('/billing/totals'),
    apiFetch<{ currency: string; points: { period: string; label: string; collected: number }[] }>(
      '/billing/revenue?months=6',
    ),
    apiFetch<Paginated<InvoiceSummaryView>>(
      `/billing/invoices${qs({ status, q, page, pageSize: 20 })}`,
    ),
    apiFetch<PaymentView[]>('/billing/payments?limit=8'),
  ]);

  const main = totals[0];
  const currency = main?.currency ?? revenue.currency;
  const others = totals.slice(1);
  const href = (p: Record<string, string | number | undefined>) =>
    `${paths.list}${qs({ status, q, ...p })}`;

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle={
          manager
            ? 'What has been billed, what has come in, and what is still owed.'
            : 'Invoices and payments for your clients.'
        }
        actions={
          <>
            {paths.packages && (
              <LinkButton href={paths.packages} variant="secondary">
                Fee catalogue
              </LinkButton>
            )}
            {paths.quotes && canInvoice && (
              <LinkButton href={`${paths.quotes}/new`} variant="secondary">
                New quote
              </LinkButton>
            )}
            {canInvoice && (
              <LinkButton href={paths.newInvoice}>
                <IconPlus size={16} />
                New invoice
              </LinkButton>
            )}
          </>
        }
      />

      {user && (manager || hasWorkspace(user)) && <FinanceTabs user={user} active="invoices" />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Collected, last 30 days"
          value={formatMoney(main?.collected30 ?? 0, currency)}
          tone="ok"
          icon={<IconCheck size={18} />}
          hint="payments less refunds"
        />
        <StatCard
          label="Outstanding"
          value={formatMoney(main?.outstanding ?? 0, currency)}
          tone={main?.outstanding ? 'warn' : 'neutral'}
          icon={<IconClock size={18} />}
          hint="issued and not yet paid"
          href={href({ status: 'open', page: undefined })}
        />
        <StatCard
          label="Overdue"
          value={formatMoney(main?.overdue ?? 0, currency)}
          tone={main?.overdue ? 'bad' : 'neutral'}
          icon={<IconAlert size={18} />}
          hint="past the due date"
          href={href({ status: 'overdue', page: undefined })}
        />
        <StatCard
          label="Collected, all time"
          value={formatMoney(main?.collected ?? 0, currency)}
          icon={<IconWallet size={18} />}
          hint={`of ${formatMoney(main?.invoiced ?? 0, currency)} invoiced`}
        />
      </div>

      {others.length > 0 && (
        <p className="mt-3 text-[12.5px] text-ink-500">
          Also in other currencies:{' '}
          {others
            .map((t) => `${formatMoney(t.outstanding, t.currency)} outstanding of ${formatMoney(t.invoiced, t.currency)}`)
            .join(' · ')}
        </p>
      )}

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="Money collected" subtitle={`Per month, in ${revenue.currency}, payments less refunds`}>
          <BarChart
            points={revenue.points.map((p) => ({ key: p.period, label: p.label, value: p.collected }))}
            currency={revenue.currency}
            ariaLabel={`Money collected per month in ${revenue.currency}`}
            valueLabel="collected"
          />
        </Panel>

        <Panel title="Latest receipts" subtitle="The most recent money in and out" bodyClassName="pb-2">
          {recent.length === 0 ? (
            <p className="px-4 pb-4 text-[13px] text-ink-400 sm:px-5">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`${paths.receipt}/${p.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-ink-50 sm:px-5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-medium text-ink-900">{p.clientName}</p>
                      <p className="text-[12px] text-ink-400">
                        {p.number} · {formatDate(p.receivedOn)}
                      </p>
                    </div>
                    <span
                      className={cx(
                        'tnum shrink-0 text-[13.5px] font-semibold',
                        p.voided ? 'text-ink-400 line-through' : p.kind === 'refund' ? 'text-bad-700' : 'text-ok-700',
                      )}
                    >
                      {p.kind === 'refund' ? '−' : '+'}
                      {formatMoney(p.amount, p.currency)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Card className="mt-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 pt-3 sm:px-5">
          <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Invoice status">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={href({ status: t.key, page: undefined })}
                aria-current={status === t.key ? 'page' : undefined}
                className={cx(
                  'whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-[13.5px] font-medium',
                  status === t.key ? 'border-brand-600 text-ink-950' : 'border-transparent text-ink-500 hover:text-ink-800',
                )}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <form action={paths.list} className="pb-2.5">
            <input type="hidden" name="status" value={status} />
            <input
              name="q"
              defaultValue={q}
              placeholder="Invoice number or client"
              className="h-8 w-56 rounded-md border border-line-strong bg-paper px-2.5 text-[13px] text-ink-800 placeholder:text-ink-300"
            />
          </form>
        </div>
        <InvoiceTable
          invoices={invoices.items}
          hrefBase={paths.invoice}
          empty={status === 'overdue' ? 'Nothing overdue.' : 'No invoices here.'}
        />
      </Card>
      <Pagination data={invoices} buildHref={(p) => href({ page: p })} />
    </>
  );
}
