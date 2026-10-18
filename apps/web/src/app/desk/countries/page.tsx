import { requireRole } from '@/lib/session';
import { CountriesPage } from '@/components/workflows/pages';

export const metadata = { title: 'Countries' };

export default async function DeskCountriesPage() {
  const user = await requireRole('consultant');
  return <CountriesPage user={user} base="/desk" />;
}
