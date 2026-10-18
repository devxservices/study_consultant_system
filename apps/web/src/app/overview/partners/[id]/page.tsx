import { requireRole } from '@/lib/session';
import { PartnerPage } from '@/components/partners/staff-pages';

export const metadata = { title: 'Partner' };

export default async function ManagerPartnersItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireRole('manager');
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  return <PartnerPage user={user} id={id} tab={tab} />;
}
