import { requireRole } from '@/lib/session';
import { AutomationEditPage } from '@/components/workflows/pages';

export const metadata = { title: 'Automation' };

export default async function DeskAutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('consultant');
  return <AutomationEditPage user={user} base="/desk" id={(await params).id} />;
}
