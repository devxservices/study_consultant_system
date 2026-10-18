import { requireRole } from '@/lib/session';
import { LeaderboardPage } from '@/components/partners/staff-pages';

export const metadata = { title: 'Partner leaderboard' };

export default async function ManagerPartnersLeaderboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return <LeaderboardPage user={user} query={await searchParams} />;
}
