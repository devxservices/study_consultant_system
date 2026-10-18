import { requireRole } from '@/lib/session';
import { NewBatchPage } from '@/components/courses/course-pages';

export const metadata = { title: 'New batch' };

export default async function DeskCoursesBatchesNewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('consultant');
  return <NewBatchPage user={user} query={await searchParams} />;
}
