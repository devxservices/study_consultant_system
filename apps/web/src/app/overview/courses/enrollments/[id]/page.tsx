import { requireRole } from '@/lib/session';
import { EnrollmentPage } from '@/components/courses/course-pages';

export const metadata = { title: 'Enrolment' };

export default async function ManagerCoursesEnrollmentsItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('manager');
  const { id } = await params;
  return <EnrollmentPage user={user} id={id} />;
}
