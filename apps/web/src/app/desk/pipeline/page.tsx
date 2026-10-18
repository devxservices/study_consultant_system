import { requireRole } from '@/lib/session';
import { BoardPage } from '@/components/workflows/pages';

export const metadata = { title: 'Pipeline' };

export default async function DeskPipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ templateId?: string; country?: string; consultantId?: string; q?: string; perColumn?: string }>;
}) {
  const user = await requireRole('consultant');
  return <BoardPage user={user} base="/desk" query={await searchParams} />;
}
