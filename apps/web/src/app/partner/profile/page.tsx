import { requireRole } from '@/lib/session';
import { PartnerProfilePage } from '@/components/partners/portal-pages';

export const metadata = { title: 'Your organisation' };

export default async function PartnerProfileRoute() {
  await requireRole('partner');
  return <PartnerProfilePage />;
}
