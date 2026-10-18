import { requireRole } from '@/lib/session';
import { PartnerNewStudentPage } from '@/components/partners/portal-pages';

export const metadata = { title: 'Register a student' };

export default async function PartnerStudentsNewRoute() {
  await requireRole('partner');
  return <PartnerNewStudentPage />;
}
