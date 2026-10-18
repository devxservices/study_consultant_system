import { requireRole } from '@/lib/session';
import { PartnerStudentsPage } from '@/components/partners/portal-pages';

export const metadata = { title: 'Students' };

export default async function PartnerStudentsRoute({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole('partner');
  return <PartnerStudentsPage query={await searchParams} />;
}
