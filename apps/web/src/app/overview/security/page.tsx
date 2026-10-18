import Link from 'next/link';
import {
  ROLE_LABEL,
  type AuditEntryView,
  type ConsultancyDefaults,
  type MfaPolicy,
  type Paginated,
  type TeamMember,
} from '@crm/shared';
import { AuditList } from '@/components/audit/audit-list';
import { apiFetch } from '@/lib/api';
import { requireRole } from '@/lib/session';
import { enabledModules } from '@/lib/entitlements';
import { Avatar, Card, PageHeader, Panel, PanelLink, Pill } from '@/components/ui';
import { MfaPolicyForm } from '@/components/team/mfa-policy-form';
import { PermissionEditor } from '@/components/team/permission-editor';
import { EmailSettings } from '@/components/team/email-settings';
import { IconLock, IconShield } from '@/components/icons';

export const metadata = { title: 'Security' };

/**
 * The owner's security settings in one place: who must use two-step
 * verification, where everyone stands on it, and what consultants may do
 * by default.
 */
export default async function SecurityPage() {
  const user = await requireRole('manager');
  const [{ policy }, team, defaults, modules, changes, emailSettings] = await Promise.all([
    apiFetch<{ policy: MfaPolicy }>('/team/security'),
    apiFetch<TeamMember[]>('/team'),
    apiFetch<ConsultancyDefaults>('/team/defaults'),
    enabledModules(),
    apiFetch<Paginated<AuditEntryView>>('/analytics/audit?category=team&pageSize=8').catch(() => null),
    apiFetch<Record<string, boolean>>('/team/email-notifications'),
  ]);
  const active = team.filter((m) => m.active);
  const on = active.filter((m) => m.mfaEnabled).length;

  return (
    <>
      <PageHeader
        title="Security"
        subtitle="Two-step verification, and what consultants can do unless you say otherwise."
      />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          title="Two-step verification"
          subtitle="A code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) after the password."
        >
          <MfaPolicyForm
            initial={policy}
            withoutTwoStep={active.filter((m) => !m.mfaEnabled && m.userId !== user.id).length}
            ownEnabled={user.mfaEnabled}
            accountHref="/overview/account"
          />
        </Panel>

        <Panel
          title="Who has it on"
          subtitle={`${on} of ${active.length} active staff`}
          action={<PanelLink href="/overview/consultants">Team</PanelLink>}
          bodyClassName=""
        >
          <div className="h-1.5 bg-ink-100" aria-hidden>
            <div className="h-full bg-ok-500" style={{ width: `${active.length ? (on / active.length) * 100 : 0}%` }} />
          </div>
          <ul className="divide-y divide-line">
            {active.map((m) => (
              <li key={m.userId} className="flex items-center gap-2.5 px-4 py-2.5 sm:px-5">
                <Avatar name={m.name} size={28} />
                <Link href={`/overview/consultants/${m.userId}?tab=security`} className="min-w-0 flex-1 hover:underline">
                  <span className="block truncate text-[13.5px] font-medium text-ink-900">{m.name}</span>
                  <span className="block text-[12px] text-ink-400">{ROLE_LABEL[m.role]}</span>
                </Link>
                {m.mfaEnabled ? (
                  <Pill tone="ok" dot>
                    On
                  </Pill>
                ) : (
                  <Pill tone="warn" dot>
                    Off
                  </Pill>
                )}
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-4 py-2.5 text-[12px] text-ink-400 sm:px-5">
            {team.find((m) => m.userId === user.id)?.mfaEnabled ? (
              'Your own account is protected.'
            ) : (
              <>
                Your own account does not have it yet -{' '}
                <Link href="/overview/account" className="font-medium text-brand-700 hover:underline">
                  set it up
                </Link>
                .
              </>
            )}
          </p>
        </Panel>
      </div>

      <section id="defaults" className="mt-8 scroll-mt-20">
        <div className="mb-3 flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info-50 text-info-600">
            <IconShield size={19} />
          </span>
          <div>
            <h2 className="text-[17px] font-semibold text-ink-950">Default permissions for consultants</h2>
            <p className="mt-0.5 max-w-3xl text-[13px] text-ink-500">
              What every consultant can do. To make one person different, open them from the{' '}
              <Link href="/overview/consultants" className="font-medium text-brand-700 hover:underline">
                team list
              </Link>{' '}
              - their own setting wins over this one.
            </p>
          </div>
        </div>
        <PermissionEditor mode="consultancy" defaults={defaults} modules={[...modules]} />
      </section>

      <section id="email" className="mt-8 scroll-mt-20">
        <div className="mb-3">
          <h2 className="text-[17px] font-semibold text-ink-950">Email notifications</h2>
          <p className="mt-0.5 max-w-3xl text-[13px] text-ink-500">
            Everything always reaches the bell in the app. Ticked items are emailed as well, from your
            consultancy’s name - receipts go with the PDF attached. Roles and permissions are on the{' '}
            <Link href="/overview/roles" className="font-medium text-brand-700 hover:underline">
              Roles
            </Link>{' '}
            page.
          </p>
        </div>
        <EmailSettings initial={emailSettings} />
      </section>

      {changes && changes.items.length > 0 && (
        <Panel
          title="Recent changes"
          subtitle="Permissions, this policy, and people added or switched off - with who did it."
          action={<PanelLink href="/overview/audit?category=team">Full history</PanelLink>}
          bodyClassName=""
          className="mt-8"
        >
          <div className="border-t border-line">
            <AuditList items={changes.items} base="/overview" />
          </div>
        </Panel>
      )}

      <Card className="mt-8 flex items-start gap-3 p-4 sm:p-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-600">
          <IconLock size={17} />
        </span>
        <p className="text-[13px] leading-relaxed text-ink-600">
          <span className="font-medium text-ink-900">The audit trail is permanent.</span> Every sign-in, every
          record opened, every change to a permission or this policy is written down with the address and
          device it came from, and the database itself refuses to edit or delete any of it.{' '}
          <Link href="/overview/audit?category=team" className="font-medium text-brand-700 hover:underline">
            See security changes
          </Link>
        </p>
      </Card>
    </>
  );
}
