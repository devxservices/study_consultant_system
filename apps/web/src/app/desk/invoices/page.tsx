import { requireRole } from '@/lib/session';
import { can } from '@/lib/permissions';
import { NoAccess } from '@/components/no-access';
import { FinancePage } from '@/components/billing/finance-page';

export const metadata = { title: 'Invoices' };

export default async function DeskInvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('consultant');
  if (!can(user, 'billing.view')) return <NoAccess title="Invoices" permission="billing.view" />;
  return (
    <FinancePage
      manager={false}
      user={user}
      canInvoice={can(user, 'billing.invoice')}
      searchParams={await searchParams}
      paths={{
        list: '/desk/invoices',
        invoice: '/desk/invoices',
        receipt: '/desk/invoices/receipts',
        newInvoice: '/desk/invoices/new',
        quotes: '/desk/invoices/quotes',
        ...(can(user, 'finance.settings') ? { packages: '/desk/finance/settings?tab=catalogue' } : {}),
      }}
    />
  );
}
