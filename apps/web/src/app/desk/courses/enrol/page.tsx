import { requireRole } from '@/lib/session';
import { EnrolPage } from '@/components/courses/course-pages';

export const metadata = { title: 'Enrol a student' };

export default async function DeskCoursesEnrolPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('consultant');
  return <EnrolPage user={user} query={await searchParams} />;
}
