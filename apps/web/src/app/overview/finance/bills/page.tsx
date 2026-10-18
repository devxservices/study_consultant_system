import { requireRole } from '@/lib/session';
import { BillsPage } from '@/components/finance/spending-pages';

export const metadata = { title: 'Bills' };

export default async function OverviewBillsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return <BillsPage user={user} query={await searchParams} />;
}
