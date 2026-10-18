import { requireRole } from '@/lib/session';
import { getNotificationFeed } from '@/lib/notifications';
import { AppShell } from '@/components/app-shell';

/**
 * The platform admin's portal. Same chrome as the consultancy portals, so the
 * product feels like one thing - but it only ever shows consultancies as
 * accounts, never what is inside them.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole('super_admin');
  const notifications = await getNotificationFeed();

  return (
    <AppShell
      user={user}
      notifications={notifications}
      nav={[
        { href: '/admin', label: 'Consultancies', section: 'Platform' },
        { href: '/admin/tenants/new', label: 'Add consultancy', section: 'Platform' },
        { href: '/admin/plans', label: 'Plans', section: 'Platform' },
        { href: '/admin/settings', label: 'Settings', section: 'Platform' },
      ]}
    >
      {children}
    </AppShell>
  );
}
