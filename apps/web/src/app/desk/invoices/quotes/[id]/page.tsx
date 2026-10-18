import { requireRole } from '@/lib/session';
import { can } from '@/lib/permissions';
import { NoAccess } from '@/components/no-access';
import { QuoteDetailPage } from '@/components/finance/quotes';

export const metadata = { title: 'Quote' };

export default async function DeskQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('consultant');
  if (!can(user, 'billing.view')) return <NoAccess title="Quote" permission="billing.view" />;
  return <QuoteDetailPage user={user} id={(await params).id} />;
}
