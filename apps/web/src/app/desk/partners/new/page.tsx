import { requireRole } from '@/lib/session';
import { NewPartnerPage } from '@/components/partners/staff-pages';

export const metadata = { title: 'Add a partner' };

export default async function DeskPartnersNewPage() {
  const user = await requireRole('consultant');
  return <NewPartnerPage user={user} />;
}
