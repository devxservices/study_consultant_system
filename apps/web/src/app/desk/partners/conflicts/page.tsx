import { requireRole } from '@/lib/session';
import { ConflictsPage } from '@/components/partners/staff-pages';

export const metadata = { title: 'Who a student belongs to' };

export default async function DeskPartnersConflictsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('consultant');
  return <ConflictsPage user={user} query={await searchParams} />;
}
