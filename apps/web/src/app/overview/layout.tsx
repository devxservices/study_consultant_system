import type { TaskCounts } from '@crm/shared';
import { requireRole } from '@/lib/session';
import { getNotificationFeed } from '@/lib/notifications';
import { enabledModules } from '@/lib/entitlements';
import { AppShell, type NavItem, type QuickAction } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';
import { SubscriptionNotice } from '@/components/subscription-notice';

export default async function OverviewLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole('manager');
  const [notifications, modules] = await Promise.all([getNotificationFeed(), enabledModules()]);

  // The counts that ride in the nav, so they are visible from every screen.
  const [stuck, tasks] = await Promise.all([
    apiFetch<{ total: number }>('/analytics/stuck?pageSize=1')
      .then((r) => r.total)
      .catch(() => 0),
    modules.has('tasks')
      ? apiFetch<TaskCounts>('/tasks/counts?scope=all').catch(() => null)
      : Promise.resolve(null),
  ]);

  const nav: NavItem[] = [
    { href: '/overview', label: 'Overview', section: 'Workspace' },
    { href: '/overview/clients', label: 'All clients', section: 'Workspace' },
    { href: '/overview/pipeline', label: 'Pipeline', section: 'Workspace' },
    { href: '/overview/documents', label: 'Documents', section: 'Workspace' },
    { href: '/overview/stuck', label: 'Not moving', badge: stuck || undefined, section: 'Workspace' },
    ...(modules.has('tasks')
      ? [{ href: '/overview/tasks', label: 'Tasks', badge: tasks?.overdue || undefined, section: 'Workspace' }]
      : []),
    ...(modules.has('billing') ? [{ href: '/overview/finance', label: 'Finance', section: 'Business' }] : []),
    { href: '/overview/universities', label: 'Universities', section: 'Business' },
    { href: '/overview/commissions', label: 'Commissions', section: 'Business' },
    { href: '/overview/partners', label: 'Partners', section: 'Business' },
    { href: '/overview/courses', label: 'Courses', section: 'Business' },
    { href: '/overview/workflows', label: 'Workflows', section: 'Business' },
    { href: '/overview/countries', label: 'Countries', section: 'Business' },
    { href: '/overview/consultants', label: 'Team', section: 'Business' },
    ...(modules.has('announcements')
      ? [{ href: '/overview/announcements', label: 'Announcements', section: 'Business' }]
      : []),
    { href: '/overview/branding', label: 'Branding', section: 'Oversight' },
    { href: '/overview/subscription', label: 'Subscription', section: 'Oversight' },
    { href: '/overview/roles', label: 'Roles', section: 'Oversight' },
    { href: '/overview/audit', label: 'Audit trail', section: 'Oversight' },
    { href: '/overview/security', label: 'Security', section: 'Oversight' },
    { href: '/overview/export', label: 'Export', section: 'Oversight' },
  ];

  // Managers can do all of these; the API checks again regardless.
  const quickActions: QuickAction[] = [
    { href: '/overview/clients/new', label: 'Client', hint: 'Add someone from their first call', icon: 'client' },
    ...(modules.has('billing')
      ? [{ href: '/overview/finance/new', label: 'Invoice', hint: 'Bill a client from your price list', icon: 'invoice' } as const]
      : []),
    ...(modules.has('tasks')
      ? [{ href: '/overview/tasks', label: 'Task', hint: 'A follow-up with a due date', icon: 'task' } as const]
      : []),
    ...(modules.has('announcements')
      ? [{ href: '/overview/announcements', label: 'Announcement', hint: 'Post to clients, staff or both', icon: 'announcement' } as const]
      : []),
    { href: '/overview/consultants/new', label: 'Team member', hint: 'Invite a new colleague', icon: 'staff' },
  ];

  return (
    <AppShell
      user={user}
      notifications={notifications}
      searchAction="/overview/clients"
      nav={nav}
      quickActions={quickActions}
    >
      <SubscriptionNotice user={user} />
      {children}
    </AppShell>
  );
}
