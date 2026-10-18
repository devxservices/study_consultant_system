import { requireRole } from '@/lib/session';
import { BankIndexPage } from '@/components/finance/bank-pages';

export const metadata = { title: 'Bank and cash' };

export default async function DeskBankPage() {
  const user = await requireRole('consultant');
  return <BankIndexPage user={user} />;
}
