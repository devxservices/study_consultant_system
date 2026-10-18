import { requireRole } from '@/lib/session';
import { DrivePage } from '@/components/drive/drive-page';

export const metadata = { title: 'Documents' };

export default async function ManagerDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireRole('manager');
  return <DrivePage user={user} basePath="/overview/documents" searchParams={await searchParams} />;
}
