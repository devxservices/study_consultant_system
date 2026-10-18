import { requireRole } from '@/lib/session';
import { BankAccountPage } from '@/components/finance/bank-pages';

export const metadata = { title: 'Bank account' };

export default async function DeskBankAccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ currency?: string }> }) {
  const user = await requireRole('consultant');
  return <BankAccountPage user={user} id={(await params).id} currency={(await searchParams).currency} />;
}
