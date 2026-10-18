import { requireRole } from '@/lib/session';
import { AutomationsPage } from '@/components/workflows/pages';

export const metadata = { title: 'Automations' };

export default async function ManagerAutomationsPage() {
  const user = await requireRole('manager');
  return <AutomationsPage user={user} base="/overview" />;
}
