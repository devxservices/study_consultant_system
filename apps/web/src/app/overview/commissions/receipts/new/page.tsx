import { requireRole } from '@/lib/session';
import { NewReceiptPage } from '@/components/commissions/commission-pages';

export const metadata = { title: 'Record a receipt' };

export default async function ManagerCommissionsReceiptsNewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return <NewReceiptPage user={user} query={await searchParams} />;
}
