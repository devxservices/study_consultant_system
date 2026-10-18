import { requireRole } from '@/lib/session';
import { PartnerTeamPage } from '@/components/partners/portal-pages';

export const metadata = { title: 'Team' };

export default async function PartnerTeamRoute() {
  await requireRole('partner');
  return <PartnerTeamPage />;
}
