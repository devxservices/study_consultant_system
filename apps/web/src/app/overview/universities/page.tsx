import { requireRole } from '@/lib/session';
import { InstitutionsPage } from '@/components/commissions/institution-pages';

export const metadata = { title: 'Universities' };

export default async function ManagerUniversitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return <InstitutionsPage user={user} query={await searchParams} />;
}
