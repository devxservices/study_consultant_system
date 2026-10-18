import { requireRole } from '@/lib/session';
import { getNotificationFeed } from '@/lib/notifications';
import { apiFetch } from '@/lib/api';
import { AppShell, type NavItem } from '@/components/app-shell';

/**
 * The partner's portal: its students, what it earns and is paid, the
 * consultancy's material and messages, its agreement and its team. Money is
 * for the partner's owner and administrators; counsellors work with students.
 */
export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole('partner');
  const [notifications, me] = await Promise.all([
    getNotificationFeed(),
    apiFetch<{ canManage: boolean; status: string }>('/partner-portal/me').catch(() => ({ canManage: false, status: 'onboarding' })),
  ]);
  const work = 'Your work';
  const org = 'Your organisation';
  const nav: NavItem[] = [
    { href: '/partner', label: 'Dashboard', section: work },
    { href: '/partner/students', label: 'Students', section: work },
    ...(me.canManage
      ? [
          { href: '/partner/commissions', label: 'Commissions', section: work },
          { href: '/partner/payouts', label: 'Payouts', section: work },
        ]
      : []),
    { href: '/partner/resources', label: 'Resources', section: work },
    { href: '/partner/messages', label: 'Messages', section: work },
    { href: '/partner/agreement', label: 'Agreement', section: org },
    { href: '/partner/team', label: 'Team', section: org },
    { href: '/partner/profile', label: 'Profile and papers', section: org },
  ];
  return (
    <AppShell
      user={user}
      notifications={notifications}
      nav={nav}
      searchAction="/partner/students"
      quickActions={me.status === 'active' ? [{ href: '/partner/students/new', label: 'Student', hint: 'Register a student you are bringing', icon: 'client' }] : []}
    >
      {children}
    </AppShell>
  );
}
