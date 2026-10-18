import { requireRole } from '@/lib/session';
import { RulesPage } from '@/components/partners/staff-pages';

export const metadata = { title: 'Partner commission rules' };

export default async function ManagerPartnersRulesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return <RulesPage user={user} query={await searchParams} />;
}
