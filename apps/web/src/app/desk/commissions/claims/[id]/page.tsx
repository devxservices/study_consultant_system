import { requireRole } from '@/lib/session';
import { ClaimDetailPage } from '@/components/commissions/commission-pages';

export const metadata = { title: 'Claim' };

export default async function DeskCommissionsClaimsItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('consultant');
  const { id } = await params;
  return <ClaimDetailPage user={user} id={id} />;
}
