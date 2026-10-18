import { requireRole } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ExportPage } from '@/components/export-page';
import { NoAccess } from '@/components/no-access';

export const metadata = { title: 'Export' };

export default async function DeskExportPage() {
  const user = await requireRole('consultant');
  if (!can(user, 'data.export')) return <NoAccess title="Export" permission="data.export" />;
  return <ExportPage user={user} />;
}
