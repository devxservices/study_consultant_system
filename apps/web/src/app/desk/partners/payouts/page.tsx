import { requireRole } from '@/lib/session';
import { PayoutsPage } from '@/components/partners/staff-pages';

export const metadata = { title: 'Partner payouts' };

export default async function DeskPartnersPayoutsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('consultant');
  return <PayoutsPage user={user} query={await searchParams} />;
}
