import { requireRole } from '@/lib/session';
import { CountryEditPage } from '@/components/workflows/pages';

export const metadata = { title: 'Add a country' };

export default async function DeskNewCountryPage({ searchParams }: { searchParams: Promise<{ name?: string }> }) {
  const user = await requireRole('consultant');
  return <CountryEditPage user={user} base="/desk" name={(await searchParams).name} />;
}
