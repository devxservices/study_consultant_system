import { requireRole } from '@/lib/session';
import { BatchPage } from '@/components/courses/course-pages';

export const metadata = { title: 'Batch' };

export default async function ManagerCoursesBatchesItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireRole('manager');
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  return <BatchPage user={user} id={id} tab={tab} />;
}
