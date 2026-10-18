import { requireRole } from '@/lib/session';
import { NewCoursePage } from '@/components/courses/course-pages';

export const metadata = { title: 'Add a course' };

export default async function ManagerCoursesNewPage() {
  const user = await requireRole('manager');
  return <NewCoursePage user={user} />;
}
