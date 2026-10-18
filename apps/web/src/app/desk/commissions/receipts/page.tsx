import { requireRole } from '@/lib/session';
import { ReceiptsPage } from '@/components/commissions/commission-pages';

export const metadata = { title: 'Receipts' };

export default async function DeskCommissionsReceiptsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('consultant');
  return <ReceiptsPage user={user} query={await searchParams} />;
}
