import { requireRole } from '@/lib/session';
import { CountryEditPage } from '@/components/workflows/pages';

export const metadata = { title: 'Country' };

export default async function DeskCountryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('consultant');
  return <CountryEditPage user={user} base="/desk" id={(await params).id} />;
}
