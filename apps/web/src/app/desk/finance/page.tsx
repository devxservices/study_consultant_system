import { requireRole } from '@/lib/session';
import { NoAccess } from '@/components/no-access';
import { FinanceOverviewPage } from '@/components/finance/overview-page';
import { hasWorkspace } from '@/components/finance/workspace';

export const metadata = { title: 'Finance' };

export default async function DeskFinancePage() {
  const user = await requireRole('consultant');
  if (!hasWorkspace(user)) return <NoAccess title="Finance" permission="finance.ledger" />;
  return <FinanceOverviewPage user={user} />;
}
