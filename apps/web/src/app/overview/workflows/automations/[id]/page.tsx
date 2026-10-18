import { requireRole } from '@/lib/session';
import { AutomationEditPage } from '@/components/workflows/pages';

export const metadata = { title: 'Automation' };

export default async function ManagerAutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('manager');
  return <AutomationEditPage user={user} base="/overview" id={(await params).id} />;
}
