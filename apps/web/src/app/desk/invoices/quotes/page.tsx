import { requireRole } from '@/lib/session';
import { can } from '@/lib/permissions';
import { NoAccess } from '@/components/no-access';
import { QuotesListPage } from '@/components/finance/quotes';

export const metadata = { title: 'Quotes' };

export default async function DeskQuotesPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const user = await requireRole('consultant');
  if (!can(user, 'billing.view')) return <NoAccess title="Quotes" permission="billing.view" />;
  return <QuotesListPage user={user} query={await searchParams} />;
}
