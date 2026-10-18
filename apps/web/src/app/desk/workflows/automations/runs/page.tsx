import { requireRole } from '@/lib/session';
import { RunLogPage } from '@/components/workflows/pages';

export const metadata = { title: 'Run log' };

export default async function DeskRunLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; ruleId?: string; status?: string }>;
}) {
  const user = await requireRole('consultant');
  return <RunLogPage user={user} base="/desk" query={await searchParams} />;
}
