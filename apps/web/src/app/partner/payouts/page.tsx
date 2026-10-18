import { requireRole } from '@/lib/session';
import { PartnerPayoutsPage } from '@/components/partners/portal-pages';

export const metadata = { title: 'Payouts' };

export default async function PartnerPayoutsRoute() {
  await requireRole('partner');
  return <PartnerPayoutsPage />;
}
