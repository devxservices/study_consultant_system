import { requireRole } from '@/lib/session';
import { BoardPage } from '@/components/workflows/pages';

export const metadata = { title: 'Pipeline' };

export default async function ManagerPipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ templateId?: string; country?: string; consultantId?: string; q?: string; perColumn?: string }>;
}) {
  const user = await requireRole('manager');
  return <BoardPage user={user} base="/overview" query={await searchParams} />;
}
