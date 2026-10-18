import { requireRole } from '@/lib/session';
import { BatchesPage } from '@/components/courses/course-pages';

export const metadata = { title: 'Batches' };

export default async function ManagerCoursesBatchesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return <BatchesPage user={user} query={await searchParams} />;
}
