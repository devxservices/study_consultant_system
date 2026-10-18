import { requireRole } from '@/lib/session';
import { NewPartnerPage } from '@/components/partners/staff-pages';

export const metadata = { title: 'Add a partner' };

export default async function ManagerPartnersNewPage() {
  const user = await requireRole('manager');
  return <NewPartnerPage user={user} />;
}
