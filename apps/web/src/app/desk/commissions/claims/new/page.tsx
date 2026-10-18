import { requireRole } from '@/lib/session';
import { NewClaimPage } from '@/components/commissions/commission-pages';

export const metadata = { title: 'New claim' };

export default async function DeskCommissionsClaimsNewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('consultant');
  return <NewClaimPage user={user} query={await searchParams} />;
}
