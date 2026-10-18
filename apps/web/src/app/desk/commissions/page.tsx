import { requireRole } from '@/lib/session';
import { CommissionsOverviewPage } from '@/components/commissions/commission-pages';

export const metadata = { title: 'Commissions' };

export default async function DeskCommissionsPage() {
  const user = await requireRole('consultant');
  return <CommissionsOverviewPage user={user} />;
}
