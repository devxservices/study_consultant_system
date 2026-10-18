import { requireRole } from '@/lib/session';
import { CommissionDetailPage } from '@/components/commissions/commission-pages';

export const metadata = { title: 'Commission' };

export default async function ManagerCommissionsItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('manager');
  const { id } = await params;
  return <CommissionDetailPage user={user} id={id} />;
}
