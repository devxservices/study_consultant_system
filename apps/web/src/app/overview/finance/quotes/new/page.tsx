import { requireRole } from '@/lib/session';
import { NewBillPage } from '@/components/finance/new-bill-page';

export const metadata = { title: 'New quote' };

export default async function OverviewNewQuotePage({ searchParams }: { searchParams: Promise<{ clientId?: string; caseId?: string }> }) {
  const user = await requireRole('manager');
  const { clientId, caseId } = await searchParams;
  return <NewBillPage user={user} mode="quote" clientId={clientId} caseId={caseId} />;
}
