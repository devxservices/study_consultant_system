import { requireRole } from '@/lib/session';
import { DriveSettingsPage } from '@/components/drive/settings-page';

export const metadata = { title: 'Document settings' };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireRole('manager');
  return <DriveSettingsPage user={user} basePath="/overview/documents" tab={(await searchParams).tab} />;
}
