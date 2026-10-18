import { requireRole } from '@/lib/session';
import { FinanceSettingsPage } from '@/components/finance/settings-and-statement';

export const metadata = { title: 'Finance settings' };

export default async function OverviewFinanceSettingsRoute({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('manager');
  return <FinanceSettingsPage user={user} tab={(await searchParams).tab} />;
}
