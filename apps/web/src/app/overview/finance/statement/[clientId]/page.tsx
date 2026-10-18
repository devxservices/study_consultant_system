import { requireRole } from '@/lib/session';
import { StatementPage } from '@/components/finance/settings-and-statement';

export const metadata = { title: 'Statement' };

export default async function OverviewStatementPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ currency?: string; from?: string; to?: string }> }) {
  const user = await requireRole('manager');
  return <StatementPage user={user} clientId={(await params).clientId} query={await searchParams} backHref={`/overview/clients/${(await params).clientId}`} />;
}
