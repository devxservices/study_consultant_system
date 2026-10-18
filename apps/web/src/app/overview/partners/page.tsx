import { requireRole } from '@/lib/session';
import { PartnersListPage } from '@/components/partners/staff-pages';

export const metadata = { title: 'Partners' };

export default async function ManagerPartnersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return <PartnersListPage user={user} query={await searchParams} />;
}
