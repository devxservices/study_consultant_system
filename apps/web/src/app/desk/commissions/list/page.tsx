import { requireRole } from '@/lib/session';
import { CommissionsListPage } from '@/components/commissions/commission-pages';

export const metadata = { title: 'Commissions' };

export default async function DeskCommissionsListPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('consultant');
  return <CommissionsListPage user={user} query={await searchParams} />;
}
