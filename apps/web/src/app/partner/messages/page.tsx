import { requireRole } from '@/lib/session';
import { PartnerMessagesPage } from '@/components/partners/portal-pages';

export const metadata = { title: 'Messages' };

export default async function PartnerMessagesRoute() {
  await requireRole('partner');
  return <PartnerMessagesPage />;
}
