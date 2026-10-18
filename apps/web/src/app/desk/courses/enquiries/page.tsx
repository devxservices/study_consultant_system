import { requireRole } from '@/lib/session';
import { EnquiriesPage } from '@/components/courses/student-pages';

export const metadata = { title: 'Course enquiries' };

export default async function DeskCoursesEnquiriesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('consultant');
  return <EnquiriesPage user={user} query={await searchParams} />;
}
