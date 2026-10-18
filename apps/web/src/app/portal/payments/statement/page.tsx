import { requireRole } from '@/lib/session';
import { StatementPage } from '@/components/finance/settings-and-statement';

export const metadata = { title: 'Statement' };

export default async function PortalStatementPage({ searchParams }: { searchParams: Promise<{ currency?: string; from?: string; to?: string }> }) {
  const user = await requireRole('client');
  return <StatementPage user={user} query={await searchParams} backHref="/portal/payments" />;
}
