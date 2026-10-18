import { requireRole } from '@/lib/session';
import { CoursesPage } from '@/components/courses/course-pages';

export const metadata = { title: 'Courses' };

export default async function DeskCoursesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('consultant');
  return <CoursesPage user={user} query={await searchParams} />;
}
