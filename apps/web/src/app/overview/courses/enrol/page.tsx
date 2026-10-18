import { requireRole } from '@/lib/session';
import { EnrolPage } from '@/components/courses/course-pages';

export const metadata = { title: 'Enrol a student' };

export default async function ManagerCoursesEnrolPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return <EnrolPage user={user} query={await searchParams} />;
}
