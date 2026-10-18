import { requireRole } from '@/lib/session';
import { RulesPage } from '@/components/partners/staff-pages';

export const metadata = { title: 'Partner commission rules' };

export default async function DeskPartnersRulesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('consultant');
  return <RulesPage user={user} query={await searchParams} />;
}
