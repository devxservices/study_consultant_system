import { requireRole } from '@/lib/session';
import { ClaimsPage } from '@/components/commissions/commission-pages';

export const metadata = { title: 'Claims' };

export default async function DeskCommissionsClaimsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('consultant');
  return <ClaimsPage user={user} query={await searchParams} />;
}
