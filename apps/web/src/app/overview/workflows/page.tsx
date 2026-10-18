import { requireRole } from '@/lib/session';
import { WorkflowsIndexPage } from '@/components/workflows/pages';

export const metadata = { title: 'Workflows' };

export default async function ManagerWorkflowsPage() {
  const user = await requireRole('manager');
  return <WorkflowsIndexPage user={user} base="/overview" />;
}
