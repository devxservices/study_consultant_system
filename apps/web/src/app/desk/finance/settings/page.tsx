import { requireRole } from '@/lib/session';
import { FinanceSettingsPage } from '@/components/finance/settings-and-statement';

export const metadata = { title: 'Finance settings' };

export default async function DeskFinanceSettingsRoute({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole('consultant');
  return <FinanceSettingsPage user={user} tab={(await searchParams).tab} />;
}
