import { requireRole } from '@/lib/session';
import { CourseSettingsPage } from '@/components/courses/course-pages';

export const metadata = { title: 'Course settings' };

export default async function ManagerCoursesSettingsPage() {
  const user = await requireRole('manager');
  return <CourseSettingsPage user={user} />;
}
