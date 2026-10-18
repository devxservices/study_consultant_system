import { requireRole } from '@/lib/session';
import { InstitutionsPage } from '@/components/commissions/institution-pages';

export const metadata = { title: 'Universities' };

export default async function DeskUniversitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('consultant');
  return <InstitutionsPage user={user} query={await searchParams} />;
}
