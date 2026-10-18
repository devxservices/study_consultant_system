import { requireRole } from '@/lib/session';
import { NewCoursePage } from '@/components/courses/course-pages';

export const metadata = { title: 'Add a course' };

export default async function DeskCoursesNewPage() {
  const user = await requireRole('consultant');
  return <NewCoursePage user={user} />;
}
