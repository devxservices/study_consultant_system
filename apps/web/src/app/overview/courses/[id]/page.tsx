import { requireRole } from '@/lib/session';
import { CoursePage } from '@/components/courses/course-pages';

export const metadata = { title: 'Course' };

export default async function ManagerCoursesItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('manager');
  const { id } = await params;
  return <CoursePage user={user} id={id} />;
}
