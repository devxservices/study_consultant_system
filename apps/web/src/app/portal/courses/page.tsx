import { requireRole } from '@/lib/session';
import { MyCoursesPage } from '@/components/courses/course-pages';

export const metadata = { title: 'Courses and tests' };

export default async function PortalCoursesPage() {
  await requireRole('client');
  return <MyCoursesPage />;
}
