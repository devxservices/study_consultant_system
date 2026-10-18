import { requireRole } from '@/lib/session';
import { NewBillPage } from '@/components/finance/new-bill-page';

export const metadata = { title: 'New invoice' };

export default async function DeskNewInvoicePage({ searchParams }: { searchParams: Promise<{ clientId?: string; caseId?: string }> }) {
  const user = await requireRole('consultant');
  const { clientId, caseId } = await searchParams;
  return <NewBillPage user={user} mode="invoice" clientId={clientId} caseId={caseId} />;
}
