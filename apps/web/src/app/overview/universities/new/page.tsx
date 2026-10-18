import { requireRole } from '@/lib/session';
import { NewInstitutionPage } from '@/components/commissions/institution-pages';

export const metadata = { title: 'Add an institution' };

export default async function ManagerUniversitiesNewPage() {
  const user = await requireRole('manager');
  return <NewInstitutionPage user={user} />;
}
