import { requireRole } from '@/lib/session';
import { CountriesPage } from '@/components/workflows/pages';

export const metadata = { title: 'Countries' };

export default async function ManagerCountriesPage() {
  const user = await requireRole('manager');
  return <CountriesPage user={user} base="/overview" />;
}
