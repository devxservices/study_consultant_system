import Link from 'next/link';
import type { AuthUser } from '@crm/shared';
import { can } from '@/lib/permissions';
import { cx } from '../ui';

/** Where each part of the money workspace lives, per portal. */
export interface FinancePaths {
  base: string;
  invoices: string;
  newInvoice: string;
  receipts: string;
  quotes: string;
  clients: string;
  /** The audience the pages are built for. */
  portal: 'overview' | 'desk';
}

export const MANAGER_PATHS: FinancePaths = {
  base: '/overview/finance',
  invoices: '/overview/finance/invoices',
  newInvoice: '/overview/finance/new',
  receipts: '/overview/finance/receipts',
  quotes: '/overview/finance/quotes',
  clients: '/overview/clients',
  portal: 'overview',
};

export const DESK_PATHS: FinancePaths = {
  base: '/desk/finance',
  invoices: '/desk/invoices',
  newInvoice: '/desk/invoices/new',
  receipts: '/desk/invoices/receipts',
  quotes: '/desk/invoices/quotes',
  clients: '/desk/clients',
  portal: 'desk',
};

export const pathsFor = (user: AuthUser): FinancePaths => (user.role === 'manager' ? MANAGER_PATHS : DESK_PATHS);

/** What this person may do in the workspace, decided once per page. */
export function financeAccess(user: AuthUser) {
  return {
    view: can(user, 'billing.view'),
    invoice: can(user, 'billing.invoice'),
    payment: can(user, 'billing.payment'),
    verify: can(user, 'billing.verify'),
    refund: can(user, 'billing.refund'),
    approve: can(user, 'billing.approve'),
    expenses: can(user, 'finance.expenses'),
    ledger: can(user, 'finance.ledger'),
    settings: can(user, 'finance.settings'),
    export: can(user, 'data.export'),
  };
}
export type FinanceAccess = ReturnType<typeof financeAccess>;

/** Anything of the accountant's workspace beyond plain invoices. */
export const hasWorkspace = (user: AuthUser) => {
  const a = financeAccess(user);
  return a.ledger || a.expenses || a.verify || a.approve || a.settings;
};

export type FinanceTab =
  | 'overview'
  | 'invoices'
  | 'quotes'
  | 'verify'
  | 'approvals'
  | 'expenses'
  | 'bills'
  | 'bank'
  | 'books'
  | 'reports'
  | 'settings';

/** The workspace's own tab bar, showing only what this person can open. */
export function FinanceTabs({ user, active, counts }: { user: AuthUser; active: FinanceTab; counts?: Partial<Record<FinanceTab, number>> }) {
  const p = pathsFor(user);
  const a = financeAccess(user);
  const tabs: { key: FinanceTab; label: string; href: string; show: boolean }[] = [
    { key: 'overview', label: 'Overview', href: p.base, show: hasWorkspace(user) },
    { key: 'invoices', label: 'Invoices', href: p.invoices, show: a.view },
    { key: 'quotes', label: 'Quotes', href: p.quotes, show: a.view },
    { key: 'verify', label: 'To verify', href: `${p.base}/verify`, show: a.verify },
    { key: 'approvals', label: 'Approvals', href: `${p.base}/approvals`, show: a.approve || a.refund },
    { key: 'expenses', label: 'Expenses', href: `${p.base}/expenses`, show: a.expenses },
    { key: 'bills', label: 'Bills', href: `${p.base}/bills`, show: a.expenses },
    { key: 'bank', label: 'Bank and cash', href: `${p.base}/bank`, show: a.ledger },
    { key: 'books', label: 'Books', href: `${p.base}/books`, show: a.ledger },
    { key: 'reports', label: 'Reports', href: `${p.base}/reports`, show: a.ledger },
    { key: 'settings', label: 'Settings', href: `${p.base}/settings`, show: a.settings || a.ledger },
  ];
  return (
    <nav className="-mb-px mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Finance">
      {tabs
        .filter((t) => t.show)
        .map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={active === t.key ? 'page' : undefined}
            className={cx(
              'flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-[13.5px] font-medium',
              active === t.key ? 'border-brand-600 text-ink-950' : 'border-transparent text-ink-500 hover:text-ink-800',
            )}
          >
            {t.label}
            {counts?.[t.key] ? <span className="tnum rounded-full bg-warn-100 px-1.5 text-[11px] font-semibold text-warn-700">{counts[t.key]}</span> : null}
          </Link>
        ))}
    </nav>
  );
}

/** A table of money in the workspace's house style. */
export function MoneyTable({ head, children, className }: { head: (string | { label: string; right?: boolean })[]; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full text-[13px]">
        <thead className="bg-ink-50 text-left text-[11.5px] uppercase tracking-wide text-ink-500">
          <tr>
            {head.map((h, i) => {
              const label = typeof h === 'string' ? h : h.label;
              const right = typeof h !== 'string' && h.right;
              return (
                <th key={`${label}-${i}`} className={cx('whitespace-nowrap px-4 py-2 font-medium', right && 'text-right')}>
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
