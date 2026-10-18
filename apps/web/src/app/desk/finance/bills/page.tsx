import { requireRole } from '@/lib/session';
import { BillsPage } from '@/components/finance/spending-pages';

export const metadata = { title: 'Bills' };

export default async function DeskBillsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('consultant');
  return <BillsPage user={user} query={await searchParams} />;
}
