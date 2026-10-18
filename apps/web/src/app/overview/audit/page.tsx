import { AuditPage } from '@/components/audit/audit-page';

export const metadata = { title: 'Audit trail' };

export default async function OverviewAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <AuditPage base="/overview" searchParams={await searchParams} canExport />;
}
