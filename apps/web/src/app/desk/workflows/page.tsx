import { requireRole } from '@/lib/session';
import { WorkflowsIndexPage } from '@/components/workflows/pages';

export const metadata = { title: 'Workflows' };

export default async function DeskWorkflowsPage() {
  const user = await requireRole('consultant');
  return <WorkflowsIndexPage user={user} base="/desk" />;
}
