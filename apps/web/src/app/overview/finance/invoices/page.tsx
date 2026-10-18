import { requireRole } from '@/lib/session';
import { FinancePage } from '@/components/billing/finance-page';

export const metadata = { title: 'Invoices' };

export default async function OverviewInvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return (
    <FinancePage
      manager
      user={user}
      searchParams={await searchParams}
      paths={{
        list: '/overview/finance/invoices',
        invoice: '/overview/finance/invoices',
        receipt: '/overview/finance/receipts',
        newInvoice: '/overview/finance/new',
        packages: '/overview/finance/packages',
        quotes: '/overview/finance/quotes',
      }}
    />
  );
}
