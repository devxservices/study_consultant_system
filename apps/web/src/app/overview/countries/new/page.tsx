import { requireRole } from '@/lib/session';
import { CountryEditPage } from '@/components/workflows/pages';

export const metadata = { title: 'Add a country' };

export default async function ManagerNewCountryPage({ searchParams }: { searchParams: Promise<{ name?: string }> }) {
  const user = await requireRole('manager');
  return <CountryEditPage user={user} base="/overview" name={(await searchParams).name} />;
}
