import { requireRole } from '@/lib/session';
import { ExpensesPage } from '@/components/finance/spending-pages';

export const metadata = { title: 'Expenses' };

export default async function DeskExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('consultant');
  return <ExpensesPage user={user} query={await searchParams} />;
}
