import { requireRole } from '@/lib/session';
import { WorkflowDetailPage } from '@/components/workflows/pages';

export const metadata = { title: 'Workflow' };

export default async function ManagerWorkflowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; version?: string }>;
}) {
  const user = await requireRole('manager');
  const [{ id }, { tab, version }] = await Promise.all([params, searchParams]);
  return <WorkflowDetailPage user={user} base="/overview" id={id} tab={tab} version={version} />;
}
