import { requireRole } from '@/lib/session';
import { ReportsIndexPage } from '@/components/finance/reports-pages';

export const metadata = { title: 'Reports' };

export default async function OverviewReportsPage() {
  const user = await requireRole('manager');
  return <ReportsIndexPage user={user} />;
}
