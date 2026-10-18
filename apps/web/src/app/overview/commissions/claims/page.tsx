import { requireRole } from '@/lib/session';
import { ClaimsPage } from '@/components/commissions/commission-pages';

export const metadata = { title: 'Claims' };

export default async function ManagerCommissionsClaimsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return <ClaimsPage user={user} query={await searchParams} />;
}
