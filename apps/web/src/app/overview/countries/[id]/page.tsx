import { requireRole } from '@/lib/session';
import { CountryEditPage } from '@/components/workflows/pages';

export const metadata = { title: 'Country' };

export default async function ManagerCountryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('manager');
  return <CountryEditPage user={user} base="/overview" id={(await params).id} />;
}
