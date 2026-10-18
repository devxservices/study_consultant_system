import { requireRole } from '@/lib/session';
import { CommissionSettingsPage } from '@/components/commissions/commission-pages';

export const metadata = { title: 'Commission settings' };

export default async function ManagerCommissionsSettingsPage() {
  const user = await requireRole('manager');
  return <CommissionSettingsPage user={user} />;
}
