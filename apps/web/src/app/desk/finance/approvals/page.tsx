import { requireRole } from '@/lib/session';
import { ApprovalsPage } from '@/components/finance/queues';

export const metadata = { title: 'Approvals' };

export default async function DeskApprovalsPage() {
  const user = await requireRole('consultant');
  return <ApprovalsPage user={user} />;
}
