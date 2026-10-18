import type { TaskCounts } from '@crm/shared';
import { requireRole } from '@/lib/session';
import { getNotificationFeed } from '@/lib/notifications';
import { enabledModules } from '@/lib/entitlements';
import { AppShell, type NavItem, type QuickAction } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';
import { SubscriptionNotice } from '@/components/subscription-notice';
import { can } from '@/lib/permissions';
import { hasWorkspace } from '@/components/finance/workspace';
import { deskHome } from '@/lib/desk-home';

interface Workload {
  pendingReviews: number;
}

export default async function DeskLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole('consultant');
  const [notifications, modules] = await Promise.all([getNotificationFeed(), enabledModules()]);

  // Whether anyone is waiting on this consultant, visible from any screen.
  const [pending, unread, tasks] = await Promise.all([
    apiFetch<Workload | null>('/consultants/me')
      .then((me) => me?.pendingReviews ?? 0)
      .catch(() => 0),
    can(user, 'chat.view')
      ? apiFetch<{ total: number }>('/messages/unread')
          .then((r) => r.total)
          .catch(() => 0)
      : Promise.resolve(0),
    modules.has('tasks') ? apiFetch<TaskCounts>('/tasks/counts').catch(() => null) : Promise.resolve(null),
  ]);

  // What a consultant sees in the menu follows what they are allowed to do.
  // The pages check again, and the API is the rule; this just keeps the menu honest.
  // A caseload's own screens are for people who carry one; an accountant or
  // a trainer starts on their own work (see deskHome).
  const caseload = deskHome(user, modules) === '/desk';
  // Someone with no caseload who cannot see every client would only ever see
  // an empty client list and an empty inbox.
  const seesClients = caseload || can(user, 'client.view_all');
  const nav: NavItem[] = [
    ...(caseload ? [{ href: '/desk', label: 'Dashboard', section: 'Workspace' }] : []),
    ...(seesClients
      ? [{ href: '/desk/clients', label: can(user, 'client.view_all') ? 'All clients' : 'Clients', section: 'Workspace' }]
      : []),
    ...(caseload ? [{ href: '/desk/pipeline', label: 'Pipeline', section: 'Workspace' }] : []),
    ...(can(user, 'document.view')
      ? [
          ...(caseload ? [{ href: '/desk/reviews', label: 'To review', badge: pending || undefined, section: 'Workspace' }] : []),
          { href: '/desk/documents', label: 'Documents', section: 'Workspace' },
        ]
      : []),
    ...(seesClients && can(user, 'chat.view')
      ? [{ href: '/desk/messages', label: 'Messages', badge: unread || undefined, section: 'Workspace' }]
      : []),
    ...(modules.has('tasks')
      ? [
          {
            href: '/desk/tasks',
            label: 'Tasks',
            badge: (tasks?.overdue ?? 0) + (tasks?.today ?? 0) || undefined,
            section: 'Workspace',
          },
        ]
      : []),
    ...(modules.has('billing') && can(user, 'billing.view')
      ? [{ href: '/desk/invoices', label: 'Invoices', section: 'Business' }]
      : []),
    ...(modules.has('billing') && hasWorkspace(user) ? [{ href: '/desk/finance', label: 'Finance', section: 'Business' }] : []),
    ...(caseload ? [{ href: '/desk/workload', label: 'My workload', section: 'Business' }] : []),
    { href: '/desk/universities', label: 'Universities', section: 'Business' },
    ...(can(user, 'commission.view') ? [{ href: '/desk/commissions', label: 'Commissions', section: 'Business' }] : []),
    ...(can(user, 'partner.view') ? [{ href: '/desk/partners', label: 'Partners', section: 'Business' }] : []),
    ...(can(user, 'course.view') || can(user, 'course.teach') ? [{ href: '/desk/courses', label: can(user, 'course.view') ? 'Courses' : 'My batches', section: 'Business' }] : []),
    { href: '/desk/workflows', label: 'Workflows', section: 'Business' },
    { href: '/desk/countries', label: 'Countries', section: 'Business' },
    ...(can(user, 'staff.view') ? [{ href: '/desk/team', label: 'Team', section: 'Business' }] : []),
    ...(can(user, 'audit.view') ? [{ href: '/desk/audit', label: 'Audit trail', section: 'Oversight' }] : []),
    ...(can(user, 'data.export') ? [{ href: '/desk/export', label: 'Export', section: 'Oversight' }] : []),
  ];

  // The same rule for "New": only what this consultant is allowed to start.
  const quickActions: QuickAction[] = [
    ...(can(user, 'client.create')
      ? [{ href: '/desk/clients/new', label: 'Client', hint: 'Add someone from their first call', icon: 'client' } as const]
      : []),
    ...(modules.has('billing') && can(user, 'billing.invoice')
      ? [{ href: '/desk/invoices/new', label: 'Invoice', hint: 'Bill a client from your price list', icon: 'invoice' } as const]
      : []),
    ...(modules.has('tasks')
      ? [{ href: '/desk/tasks', label: 'Task', hint: 'A follow-up with a due date', icon: 'task' } as const]
      : []),
    ...(can(user, 'staff.manage')
      ? [{ href: '/desk/team/new', label: 'Team member', hint: 'Invite a new colleague', icon: 'staff' } as const]
      : []),
  ];

  return (
    <AppShell
      user={user}
      notifications={notifications}
      searchAction={seesClients ? "/desk/clients" : undefined}
      nav={nav}
      quickActions={quickActions}
      messages={seesClients && can(user, 'chat.view') ? { href: '/desk/messages', unread } : undefined}
    >
      <SubscriptionNotice user={user} />
      {children}
    </AppShell>
  );
}
