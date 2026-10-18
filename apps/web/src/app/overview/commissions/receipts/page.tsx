import { requireRole } from '@/lib/session';
import { ReceiptsPage } from '@/components/commissions/commission-pages';

export const metadata = { title: 'Receipts' };

export default async function ManagerCommissionsReceiptsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return <ReceiptsPage user={user} query={await searchParams} />;
}
