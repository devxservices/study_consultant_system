import { requireRole } from '@/lib/session';
import { PartnerAgreementPage } from '@/components/partners/portal-pages';

export const metadata = { title: 'Partner agreement' };

export default async function PartnerAgreementRoute() {
  const user = await requireRole('partner');
  return <PartnerAgreementPage user={user} />;
}
