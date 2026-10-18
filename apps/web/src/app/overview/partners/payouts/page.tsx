import { requireRole } from '@/lib/session';
import { PayoutsPage } from '@/components/partners/staff-pages';

export const metadata = { title: 'Partner payouts' };

export default async function ManagerPartnersPayoutsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return <PayoutsPage user={user} query={await searchParams} />;
}
