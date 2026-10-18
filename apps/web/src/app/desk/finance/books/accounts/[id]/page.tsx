import { requireRole } from '@/lib/session';
import { AccountLedgerPage } from '@/components/finance/books-pages';

export const metadata = { title: 'Ledger' };

export default async function DeskLedgerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string; currency?: string }> }) {
  const user = await requireRole('consultant');
  return <AccountLedgerPage user={user} id={(await params).id} query={await searchParams} />;
}
