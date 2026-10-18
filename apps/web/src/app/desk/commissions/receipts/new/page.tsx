import { requireRole } from '@/lib/session';
import { NewReceiptPage } from '@/components/commissions/commission-pages';

export const metadata = { title: 'Record a receipt' };

export default async function DeskCommissionsReceiptsNewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('consultant');
  return <NewReceiptPage user={user} query={await searchParams} />;
}
