import { requireRole } from '@/lib/session';
import { ExpensesPage } from '@/components/finance/spending-pages';

export const metadata = { title: 'Expenses' };

export default async function OverviewExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return <ExpensesPage user={user} query={await searchParams} />;
}
