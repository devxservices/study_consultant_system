import { requireRole } from '@/lib/session';
import { NewBatchPage } from '@/components/courses/course-pages';

export const metadata = { title: 'New batch' };

export default async function ManagerCoursesBatchesNewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return <NewBatchPage user={user} query={await searchParams} />;
}
