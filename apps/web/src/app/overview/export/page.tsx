import { requireRole } from '@/lib/session';
import { ExportPage } from '@/components/export-page';

export const metadata = { title: 'Export' };

export default async function OverviewExportPage() {
  const user = await requireRole('manager');
  return <ExportPage user={user} />;
}
