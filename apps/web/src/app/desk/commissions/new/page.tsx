import { requireRole } from '@/lib/session';
import { NewCommissionPage } from '@/components/commissions/commission-pages';

export const metadata = { title: 'Add a commission' };

export default async function DeskCommissionsNewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('consultant');
  return <NewCommissionPage user={user} query={await searchParams} />;
}
