import { requireRole } from '@/lib/session';
import { CommissionSettingsPage } from '@/components/commissions/commission-pages';

export const metadata = { title: 'Commission settings' };

export default async function DeskCommissionsSettingsPage() {
  const user = await requireRole('consultant');
  return <CommissionSettingsPage user={user} />;
}
