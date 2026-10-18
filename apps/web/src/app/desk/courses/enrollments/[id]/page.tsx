import { requireRole } from '@/lib/session';
import { EnrollmentPage } from '@/components/courses/course-pages';

export const metadata = { title: 'Enrolment' };

export default async function DeskCoursesEnrollmentsItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('consultant');
  const { id } = await params;
  return <EnrollmentPage user={user} id={id} />;
}
