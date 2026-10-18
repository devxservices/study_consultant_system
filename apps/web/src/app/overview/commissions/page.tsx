import { requireRole } from '@/lib/session';
import { CommissionsOverviewPage } from '@/components/commissions/commission-pages';

export const metadata = { title: 'Commissions' };

export default async function ManagerCommissionsPage() {
  const user = await requireRole('manager');
  return <CommissionsOverviewPage user={user} />;
}
