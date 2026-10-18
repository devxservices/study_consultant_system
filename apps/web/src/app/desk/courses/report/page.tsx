import { requireRole } from '@/lib/session';
import { CourseReportPage } from '@/components/courses/course-pages';

export const metadata = { title: 'Course report' };

export default async function DeskCoursesReportPage() {
  const user = await requireRole('consultant');
  return <CourseReportPage user={user} />;
}
