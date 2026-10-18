import { requireRole } from '@/lib/session';
import { getNotificationFeed } from '@/lib/notifications';
import { enabledModules } from '@/lib/entitlements';
import { apiFetch } from '@/lib/api';
import { AppShell, type NavItem } from '@/components/app-shell';

/**
 * The client dashboard shell: the same rail as the staff portals on desktop,
 * a thumb-reachable bottom bar on a phone.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole('client');
  const [notifications, modules, unread] = await Promise.all([
    getNotificationFeed(),
    enabledModules(),
    apiFetch<{ total: number }>('/messages/unread')
      .then((r) => r.total)
      .catch(() => 0),
  ]);

  const section = 'Your application';
  const nav: NavItem[] = [
    { href: '/portal', label: 'Overview', section },
    { href: '/portal/progress', label: 'Progress', section },
    { href: '/portal/documents', label: 'Documents', section },
    { href: '/portal/courses', label: 'Courses', section },
    ...(modules.has('billing') ? [{ href: '/portal/payments', label: 'Payments', section }] : []),
    { href: '/portal/messages', label: 'Messages', badge: unread || undefined, section },
  ];

  return (
    <AppShell
      user={user}
      notifications={notifications}
      nav={nav}
      messages={{ href: '/portal/messages', unread }}
    >
      {children}
    </AppShell>
  );
}
