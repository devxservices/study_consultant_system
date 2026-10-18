import { requireRole } from '@/lib/session';
import { PartnerResourcesPage } from '@/components/partners/portal-pages';

export const metadata = { title: 'Resources' };

export default async function PartnerResourcesRoute() {
  await requireRole('partner');
  return <PartnerResourcesPage />;
}
