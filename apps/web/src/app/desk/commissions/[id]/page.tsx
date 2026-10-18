import { requireRole } from '@/lib/session';
import { CommissionDetailPage } from '@/components/commissions/commission-pages';

export const metadata = { title: 'Commission' };

export default async function DeskCommissionsItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('consultant');
  const { id } = await params;
  return <CommissionDetailPage user={user} id={id} />;
}
