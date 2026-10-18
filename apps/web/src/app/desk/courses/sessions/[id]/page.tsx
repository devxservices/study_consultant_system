import { requireRole } from '@/lib/session';
import { SessionPage } from '@/components/courses/course-pages';

export const metadata = { title: 'Attendance' };

export default async function DeskCoursesSessionsItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('consultant');
  const { id } = await params;
  return <SessionPage user={user} id={id} />;
}
