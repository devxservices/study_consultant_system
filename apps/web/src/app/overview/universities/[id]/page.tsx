import { requireRole } from '@/lib/session';
import { InstitutionPage } from '@/components/commissions/institution-pages';

export const metadata = { title: 'Institution' };

export default async function ManagerUniversitiesItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('manager');
  const { id } = await params;
  return <InstitutionPage user={user} id={id} />;
}
