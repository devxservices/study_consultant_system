import { requireRole } from '@/lib/session';
import { ResultsPage } from '@/components/courses/course-pages';

export const metadata = { title: 'Test results' };

export default async function ManagerCoursesResultsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return <ResultsPage user={user} query={await searchParams} />;
}
