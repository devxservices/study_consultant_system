import { requireRole } from '@/lib/session';
import { ReportsIndexPage } from '@/components/finance/reports-pages';

export const metadata = { title: 'Reports' };

export default async function DeskReportsPage() {
  const user = await requireRole('consultant');
  return <ReportsIndexPage user={user} />;
}
