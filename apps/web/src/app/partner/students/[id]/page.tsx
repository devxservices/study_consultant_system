import { requireRole } from '@/lib/session';
import { PartnerStudentPage } from '@/components/partners/portal-pages';

export const metadata = { title: 'Student' };

export default async function PartnerStudentsItemRoute({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('partner');
  const { id } = await params;
  return <PartnerStudentPage id={id} />;
}
