import { requireRole } from '@/lib/session';
import { TasksPage } from '@/components/tasks/tasks-page';

export const metadata = { title: 'Tasks' };

export default async function OverviewTasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireRole('manager');
  return <TasksPage base="/overview" manager searchParams={await searchParams} />;
}
