import { requireRole } from '@/lib/session';
import { PartnerSettingsPage } from '@/components/partners/staff-pages';

export const metadata = { title: 'Partner settings' };

export default async function ManagerPartnersSettingsPage() {
  const user = await requireRole('manager');
  return <PartnerSettingsPage user={user} />;
}
