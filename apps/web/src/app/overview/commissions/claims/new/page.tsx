import { requireRole } from '@/lib/session';
import { NewClaimPage } from '@/components/commissions/commission-pages';

export const metadata = { title: 'New claim' };

export default async function ManagerCommissionsClaimsNewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return <NewClaimPage user={user} query={await searchParams} />;
}
