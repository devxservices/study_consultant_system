import { requireRole } from '@/lib/session';
import { BankIndexPage } from '@/components/finance/bank-pages';

export const metadata = { title: 'Bank and cash' };

export default async function OverviewBankPage() {
  const user = await requireRole('manager');
  return <BankIndexPage user={user} />;
}
