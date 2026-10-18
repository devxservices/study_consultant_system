import { requireRole } from '@/lib/session';
import { can } from '@/lib/permissions';
import { NoAccess } from '@/components/no-access';
import { DrivePage } from '@/components/drive/drive-page';

export const metadata = { title: 'Documents' };

export default async function DeskDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireRole('consultant');
  if (!can(user, 'document.view')) return <NoAccess title="Documents" permission="document.view" />;
  return <DrivePage user={user} basePath="/desk/documents" searchParams={await searchParams} />;
}
