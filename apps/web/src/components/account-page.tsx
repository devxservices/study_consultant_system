import { PERMISSION_GROUPS, ROLE_LABEL, type AuthUser, type MfaStatus } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { can } from '@/lib/permissions';
import { getSite, siteName } from '@/lib/site';
import { Avatar, Card, PageHeader, cx } from './ui';
import { ChangePasswordForm, SignOutEverywhere } from './account-settings';
import { TwoStepCard } from './two-step';
import { IconCheck, IconClose } from './icons';

/** The signed-in person's own account: who they are here, how they sign in, and what they may do. */
export async function AccountPage({ user }: { user: AuthUser }) {
  const [site, mfa] = await Promise.all([
    getSite(),
    apiFetch<MfaStatus>('/auth/mfa').catch(() => null),
  ]);
  return (
    <>
      <PageHeader title="Account settings" subtitle="Your sign-in details and how your account is protected." />
      <div className="grid items-start gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <Avatar name={user.fullName} size={52} />
              <div className="min-w-0">
                <p className="truncate text-[16px] font-semibold text-ink-950">{user.fullName}</p>
                <p className="truncate text-[13px] text-ink-500">{user.email}</p>
              </div>
            </div>
            <dl className="mt-5 space-y-2.5 border-t border-line pt-4 text-[13px]">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-400">Role</dt>
                <dd className="font-medium text-ink-800">{ROLE_LABEL[user.role]}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-400">{user.tenantId ? 'Consultancy' : 'Site'}</dt>
                <dd className="font-medium text-ink-800">{siteName(site)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-400">Two-step verification</dt>
                <dd className={cx('font-medium', user.mfaEnabled ? 'text-ok-700' : 'text-ink-800')}>
                  {user.mfaEnabled ? 'On' : 'Off'}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-[12px] leading-relaxed text-ink-400">
              To change your name or email, ask{' '}
              {user.role === 'manager' || user.role === 'super_admin'
                ? 'the platform administrator'
                : user.role === 'client'
                  ? 'your consultant'
                  : 'your manager'}
              .
            </p>
          </Card>

          {user.role === 'consultant' && <YourAccess user={user} />}
        </div>

        <div className="space-y-5">
          {mfa && <TwoStepCard status={mfa} />}
          <ChangePasswordForm />
          <SignOutEverywhere />
        </div>
      </div>
    </>
  );
}

/** What a consultant may do, as their manager has set it - so nobody has to guess why a button is missing. */
function YourAccess({ user }: { user: AuthUser }) {
  return (
    <Card className="p-5">
      <h2 className="text-[15px] font-semibold text-ink-950">What you can do</h2>
      <p className="mt-0.5 text-[12.5px] text-ink-400">Set by your manager. Ask them if you need something changed.</p>
      <div className="mt-3 space-y-3">
        {PERMISSION_GROUPS.map((g) => (
          <div key={g.key}>
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-400">{g.label}</p>
            <ul className="mt-1 space-y-0.5">
              {g.permissions.map((p) => {
                const on = can(user, p.key);
                return (
                  <li key={p.key} className={cx('flex items-center gap-1.5 text-[13px]', on ? 'text-ink-800' : 'text-ink-400')}>
                    {on ? (
                      <IconCheck size={13} className="shrink-0 text-ok-600" />
                    ) : (
                      <IconClose size={13} className="shrink-0 text-ink-300" />
                    )}
                    {p.label}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}
