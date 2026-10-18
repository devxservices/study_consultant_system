import { requireRole } from '@/lib/session';
import { JournalPage } from '@/components/finance/books-pages';

export const metadata = { title: 'Journal' };

export default async function OverviewJournalPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return <JournalPage user={user} query={await searchParams} />;
}
