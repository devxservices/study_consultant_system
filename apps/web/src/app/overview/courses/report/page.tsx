import { requireRole } from '@/lib/session';
import { CourseReportPage } from '@/components/courses/course-pages';

export const metadata = { title: 'Course report' };

export default async function ManagerCoursesReportPage() {
  const user = await requireRole('manager');
  return <CourseReportPage user={user} />;
}
