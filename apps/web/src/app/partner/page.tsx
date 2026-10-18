import { requireRole } from '@/lib/session';
import { PartnerDashboardPage } from '@/components/partners/portal-pages';

export const metadata = { title: 'Partner dashboard' };

export default async function PartnerHomeRoute() {
  const user = await requireRole('partner');
  return <PartnerDashboardPage user={user} />;
}
