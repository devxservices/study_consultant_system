import { requireRole } from '@/lib/session';
import { CommissionsListPage } from '@/components/commissions/commission-pages';

export const metadata = { title: 'Commissions' };

export default async function ManagerCommissionsListPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return <CommissionsListPage user={user} query={await searchParams} />;
}
