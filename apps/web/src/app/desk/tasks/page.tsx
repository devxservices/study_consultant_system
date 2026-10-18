import { requireRole } from '@/lib/session';
import { TasksPage } from '@/components/tasks/tasks-page';

export const metadata = { title: 'Tasks' };

export default async function DeskTasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireRole('consultant');
  return <TasksPage base="/desk" manager={false} searchParams={await searchParams} />;
}
