import { requireRole } from '@/lib/session';
import { ClaimDetailPage } from '@/components/commissions/commission-pages';

export const metadata = { title: 'Claim' };

export default async function ManagerCommissionsClaimsItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('manager');
  const { id } = await params;
  return <ClaimDetailPage user={user} id={id} />;
}
