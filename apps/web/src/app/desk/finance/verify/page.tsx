import { requireRole } from '@/lib/session';
import { VerifyPage } from '@/components/finance/queues';

export const metadata = { title: 'Payments to verify' };

export default async function DeskVerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('consultant');
  return <VerifyPage user={user} status={(await searchParams).status} />;
}
