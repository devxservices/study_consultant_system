import { requireRole } from '@/lib/session';
import { PartnerCommissionsPage } from '@/components/partners/portal-pages';

export const metadata = { title: 'Commissions' };

export default async function PartnerCommissionsRoute({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole('partner');
  return <PartnerCommissionsPage query={await searchParams} />;
}
