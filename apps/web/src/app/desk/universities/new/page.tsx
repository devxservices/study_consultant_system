import { requireRole } from '@/lib/session';
import { NewInstitutionPage } from '@/components/commissions/institution-pages';

export const metadata = { title: 'Add an institution' };

export default async function DeskUniversitiesNewPage() {
  const user = await requireRole('consultant');
  return <NewInstitutionPage user={user} />;
}
