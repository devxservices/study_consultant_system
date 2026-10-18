import { requireRole } from '@/lib/session';
import { PartnerSettingsPage } from '@/components/partners/staff-pages';

export const metadata = { title: 'Partner settings' };

export default async function DeskPartnersSettingsPage() {
  const user = await requireRole('consultant');
  return <PartnerSettingsPage user={user} />;
}
