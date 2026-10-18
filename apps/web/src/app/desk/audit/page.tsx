import { requireRole } from '@/lib/session';
import { can } from '@/lib/permissions';
import { AuditPage } from '@/components/audit/audit-page';
import { NoAccess } from '@/components/no-access';

export const metadata = { title: 'Audit trail' };

/** For a consultant a manager has trusted with the whole record. */
export default async function DeskAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole('consultant');
  if (!can(user, 'audit.view')) return <NoAccess title="Audit trail" permission="audit.view" />;
  return <AuditPage base="/desk" searchParams={await searchParams} canExport={can(user, 'data.export')} />;
}
