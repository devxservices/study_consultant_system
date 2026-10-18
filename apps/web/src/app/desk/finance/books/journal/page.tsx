import { requireRole } from '@/lib/session';
import { JournalPage } from '@/components/finance/books-pages';

export const metadata = { title: 'Journal' };

export default async function DeskJournalPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('consultant');
  return <JournalPage user={user} query={await searchParams} />;
}
