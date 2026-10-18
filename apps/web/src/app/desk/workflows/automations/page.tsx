import { requireRole } from '@/lib/session';
import { AutomationsPage } from '@/components/workflows/pages';

export const metadata = { title: 'Automations' };

export default async function DeskAutomationsPage() {
  const user = await requireRole('consultant');
  return <AutomationsPage user={user} base="/desk" />;
}
