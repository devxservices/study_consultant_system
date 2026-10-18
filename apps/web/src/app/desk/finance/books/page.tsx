import { requireRole } from '@/lib/session';
import { ChartOfAccountsPage } from '@/components/finance/books-pages';

export const metadata = { title: 'Books' };

export default async function DeskBooksPage() {
  const user = await requireRole('consultant');
  return <ChartOfAccountsPage user={user} />;
}
