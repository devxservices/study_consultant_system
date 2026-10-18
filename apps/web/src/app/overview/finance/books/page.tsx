import { requireRole } from '@/lib/session';
import { ChartOfAccountsPage } from '@/components/finance/books-pages';

export const metadata = { title: 'Books' };

export default async function OverviewBooksPage() {
  const user = await requireRole('manager');
  return <ChartOfAccountsPage user={user} />;
}
