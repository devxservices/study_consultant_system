import { requireRole } from '@/lib/session';
import { CoursesPage } from '@/components/courses/course-pages';

export const metadata = { title: 'Courses' };

export default async function ManagerCoursesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return <CoursesPage user={user} query={await searchParams} />;
}
