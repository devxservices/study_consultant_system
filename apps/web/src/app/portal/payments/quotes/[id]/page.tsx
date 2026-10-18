import { requireRole } from '@/lib/session';
import { QuoteDetailPage } from '@/components/finance/quotes';

export const metadata = { title: 'Quote' };

export default async function PortalQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('client');
  return <QuoteDetailPage user={user} id={(await params).id} base="/portal/payments" />;
}
