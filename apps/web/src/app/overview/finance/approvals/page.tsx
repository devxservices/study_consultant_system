import { requireRole } from '@/lib/session';
import { ApprovalsPage } from '@/components/finance/queues';

export const metadata = { title: 'Approvals' };

export default async function OverviewApprovalsPage() {
  const user = await requireRole('manager');
  return <ApprovalsPage user={user} />;
}
