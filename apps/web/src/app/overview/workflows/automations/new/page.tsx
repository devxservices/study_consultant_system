import { requireRole } from '@/lib/session';
import { AutomationEditPage } from '@/components/workflows/pages';

export const metadata = { title: 'New automation' };

export default async function ManagerNewAutomationPage() {
  const user = await requireRole('manager');
  return <AutomationEditPage user={user} base="/overview" />;
}
