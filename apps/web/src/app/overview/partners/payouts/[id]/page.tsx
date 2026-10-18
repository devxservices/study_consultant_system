import { requireRole } from '@/lib/session';
import { PayoutPage } from '@/components/partners/staff-pages';

export const metadata = { title: 'Payout' };

export default async function ManagerPartnersPayoutsItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('manager');
  const { id } = await params;
  return <PayoutPage user={user} id={id} />;
}
