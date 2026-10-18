import { requireRole } from '@/lib/session';
import { StudentsPage } from '@/components/courses/student-pages';

export const metadata = { title: 'Course students' };

export default async function ManagerCoursesStudentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return <StudentsPage user={user} query={await searchParams} />;
}
