import { requireRole } from '@/lib/session';
import { CourseSettingsPage } from '@/components/courses/course-pages';

export const metadata = { title: 'Course settings' };

export default async function DeskCoursesSettingsPage() {
  const user = await requireRole('consultant');
  return <CourseSettingsPage user={user} />;
}
