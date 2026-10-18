import { requireRole } from '@/lib/session';
import { FinanceOverviewPage } from '@/components/finance/overview-page';

export const metadata = { title: 'Finance' };

export default async function OverviewFinancePage() {
  const user = await requireRole('manager');
  return <FinanceOverviewPage user={user} />;
}
