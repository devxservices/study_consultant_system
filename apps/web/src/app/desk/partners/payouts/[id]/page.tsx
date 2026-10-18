import { requireRole } from '@/lib/session';
import { PayoutPage } from '@/components/partners/staff-pages';

export const metadata = { title: 'Payout' };

export default async function DeskPartnersPayoutsItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('consultant');
  const { id } = await params;
  return <PayoutPage user={user} id={id} />;
}
