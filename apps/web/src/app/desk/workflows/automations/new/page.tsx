import { requireRole } from '@/lib/session';
import { AutomationEditPage } from '@/components/workflows/pages';

export const metadata = { title: 'New automation' };

export default async function DeskNewAutomationPage() {
  const user = await requireRole('consultant');
  return <AutomationEditPage user={user} base="/desk" />;
}
