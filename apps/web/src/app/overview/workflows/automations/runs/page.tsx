import { requireRole } from '@/lib/session';
import { RunLogPage } from '@/components/workflows/pages';

export const metadata = { title: 'Run log' };

export default async function ManagerRunLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; ruleId?: string; status?: string }>;
}) {
  const user = await requireRole('manager');
  return <RunLogPage user={user} base="/overview" query={await searchParams} />;
}
