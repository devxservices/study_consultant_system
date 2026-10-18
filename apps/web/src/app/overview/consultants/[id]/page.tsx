import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  localIsoDateIn,
  ROLE_LABEL,
  type AuditEntryView,
  type MemberPermissions,
  type Paginated,
  type RoleTemplateView,
  type TeamMember,
} from '@crm/shared';
import { RoleAssigner } from '@/components/team/role-assigner';
import { ApiError, apiFetch, qs } from '@/lib/api';
import { enabledModules } from '@/lib/entitlements';
import { relativeDays } from '@/lib/format';
import { Avatar, Card, EmptyState, PageHeader, Panel, PanelLink, Pill, StatCard, cx } from '@/components/ui';
import { Pagination } from '@/components/client-table';
import { ActionButton } from '@/components/forms';
import { PermissionEditor } from '@/components/team/permission-editor';
import { AuditFilters } from '@/components/audit/audit-filters';
import { AuditList } from '@/components/audit/audit-list';
import { auditFilterValues } from '@/components/audit/audit-page';
import { IconChat, IconFile, IconKey, IconUsers } from '@/components/icons';

export const metadata = { title: 'Team member' };

const TABS = [
  { key: 'permissions', label: 'Permissions' },
  { key: 'activity', label: 'Activity' },
  { key: 'security', label: 'Sign-in and security' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/**
 * One person on the team, from the owner's side: what they may do, what they
 * have done, and how they sign in.
 */
export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : 'permissions';

  let perms: MemberPermissions;
  try {
    perms = await apiFetch<MemberPermissions>(`/team/${id}/permissions`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const team = await apiFetch<TeamMember[]>('/team');
  const member = team.find((m) => m.userId === id);
  const first = perms.name.split(' ')[0];

  return (
    <>
      <PageHeader
        title={perms.name}
        breadcrumb={[{ href: '/overview/consultants', label: 'Team' }, { label: perms.name }]}
      />

      <Card className="mb-5 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={perms.name} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[17px] font-semibold text-ink-950">{perms.name}</p>
              <Pill tone={perms.role === 'manager' ? 'info' : 'neutral'}>{perms.roleName ?? ROLE_LABEL[perms.role]}</Pill>
              {!perms.active && <Pill tone="neutral">Login off</Pill>}
              {member?.mfaEnabled ? (
                <Pill tone="ok" dot>
                  Two-step on
                </Pill>
              ) : (
                <Pill tone="warn" dot>
                  Two-step off
                </Pill>
              )}
              {member && member.overrides > 0 && (
                <Pill tone="warn">
                  {member.overrides} custom {member.overrides === 1 ? 'permission' : 'permissions'}
                </Pill>
              )}
            </div>
            <p className="mt-0.5 truncate text-[13px] text-ink-500">
              {perms.email} · last signed in {relativeDays(member?.lastSignInAt ?? null)}
            </p>
          </div>
        </div>

        <nav className="-mb-4 mt-4 flex gap-1 overflow-x-auto border-t border-line pt-2 sm:-mb-5" aria-label="Sections">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/overview/consultants/${id}${t.key === 'permissions' ? '' : `?tab=${t.key}`}`}
              aria-current={tab === t.key ? 'page' : undefined}
              className={cx(
                'whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1.5 text-[13.5px] font-medium transition-colors',
                tab === t.key
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-ink-500 hover:text-ink-800',
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </Card>

      {tab === 'permissions' && <PermissionsTab perms={perms} />}
      {tab === 'activity' && <ActivityTab id={id} first={first} sp={sp} />}
      {tab === 'security' && <SecurityTab id={id} member={member} name={perms.name} />}
    </>
  );
}

async function PermissionsTab({ perms }: { perms: MemberPermissions }) {
  const [modules, history, roles] = await Promise.all([
    enabledModules(),
    // Changes made TO this person - by a manager - which their own activity never shows.
    apiFetch<Paginated<AuditEntryView>>(`/analytics/audit${qs({ entityId: perms.userId, category: 'team', pageSize: 15 })}`).catch(
      () => null,
    ),
    perms.fixed ? Promise.resolve([] as RoleTemplateView[]) : apiFetch<RoleTemplateView[]>('/team/roles'),
  ]);
  return (
    <div className="space-y-5">
      {!perms.fixed && <RoleAssigner userId={perms.userId} name={perms.name} roles={roles} current={perms.roleId} />}
      <PermissionEditor key={perms.roleId ?? 'none'} mode="member" member={perms} modules={[...modules]} />
      {history && (
        <Panel
          title="Access history"
          subtitle="Every change to what this person can do, and who made it. Permanent - nothing here can be edited."
          action={
            history.total > history.items.length ? (
              <PanelLink href={`/overview/audit?category=team&entityId=${perms.userId}`}>All of it</PanelLink>
            ) : undefined
          }
          bodyClassName=""
        >
          {history.items.length === 0 ? (
            <p className="border-t border-line px-4 py-4 text-[13px] text-ink-500 sm:px-5">
              No changes yet - {perms.name.split(' ')[0]} has {perms.fixed ? 'everything, as a manager' : 'the consultancy’s defaults'}.
            </p>
          ) : (
            <div className="border-t border-line">
              <AuditList items={history.items} base="/overview" />
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

async function ActivityTab({
  id,
  first,
  sp,
}: {
  id: string;
  first: string;
  sp: Record<string, string | string[] | undefined>;
}) {
  const f = auditFilterValues(sp);
  const { page, ...filters } = f;
  const since = localIsoDateIn(-30);
  const count = (action: string) =>
    apiFetch<Paginated<AuditEntryView>>(`/analytics/audit${qs({ actorId: id, action, from: since, pageSize: 1 })}`)
      .then((r) => r.total)
      .catch(() => 0);

  const [data, signIns, views, opens, messages] = await Promise.all([
    apiFetch<Paginated<AuditEntryView>>(`/analytics/audit${qs({ ...filters, actorId: id, page, pageSize: 50 })}`),
    count('user.signed_in'),
    count('client.viewed'),
    count('document.downloaded'),
    count('message.sent'),
  ]);
  const buildHref = (p: number) => qs({ ...filters, tab: 'activity', page: p }) || '?';

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Sign-ins" value={signIns} icon={<IconKey size={20} />} hint="Last 30 days" />
        <StatCard label="Client records opened" value={views} icon={<IconUsers size={20} />} hint="Last 30 days" />
        <StatCard label="Documents opened" value={opens} icon={<IconFile size={20} />} hint="Last 30 days" />
        <StatCard label="Messages sent" value={messages} icon={<IconChat size={20} />} hint="Last 30 days" />
      </div>

      <AuditFilters action={`/overview/consultants/${id}`} values={filters} hidden={{ tab: 'activity' }} />

      {data.items.length === 0 ? (
        <Card>
          <EmptyState
            title={Object.values(filters).some(Boolean) ? 'Nothing matches those filters' : `${first} has no recorded activity yet`}
            description="Sign-ins, client records opened, documents, messages and changes appear here."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <AuditList items={data.items} base="/overview" showActor={false} />
        </Card>
      )}
      <Pagination data={data} buildHref={buildHref} />
    </>
  );
}

async function SecurityTab({ id, member, name }: { id: string; member?: TeamMember; name: string }) {
  const first = name.split(' ')[0];
  // Their sign-ins and every two-step event about them, including resets by a manager.
  const history = await apiFetch<Paginated<AuditEntryView>>(
    `/analytics/audit${qs({ entityId: id, category: 'user', pageSize: 15 })}`,
  ).catch(() => null);
  return (
    <div className="space-y-5">
    <div className="grid items-start gap-5 xl:grid-cols-2">
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-ink-950">Two-step verification</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
          A code from an authenticator app on {first}’s phone, asked for after their password.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3.5">
          <div>
            {member?.mfaEnabled ? (
              <Pill tone="ok" dot>
                On
              </Pill>
            ) : (
              <Pill tone="warn" dot>
                Off
              </Pill>
            )}
            <p className="mt-1.5 text-[12.5px] text-ink-500">
              {member?.mfaEnabled
                ? `If ${first} has lost their phone and their recovery codes, reset it. They sign in with their password alone and set it up again.`
                : `${first} can switch it on under Account settings. To make it compulsory, change the policy on the Security page.`}
            </p>
          </div>
          {member?.mfaEnabled && (
            <ActionButton
              url={`/api/team/${id}/mfa/reset`}
              variant="danger"
              confirm={`Reset two-step verification for ${name}? Their authenticator app and recovery codes stop working, and they sign in with their password alone until they set it up again.`}
            >
              Reset two-step
            </ActionButton>
          )}
        </div>
        <p className="mt-3 text-[12px] text-ink-400">Every reset is recorded in the audit trail.</p>
      </Card>

      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-ink-950">Password and login</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
          Set a new password or switch {first}’s login off from their card on the team page.
          Switching a login off keeps every client, case and audit entry.
        </p>
        <Link
          href="/overview/consultants"
          className="mt-4 inline-flex text-[13px] font-medium text-brand-700 hover:underline"
        >
          Go to the team page
        </Link>
        <div className="mt-4 border-t border-line pt-3 text-[12.5px] text-ink-500">
          Recent sign-ins, with the address and device they came from, are under{' '}
          <Link href={`/overview/consultants/${id}?tab=activity&category=user`} className="font-medium text-brand-700 hover:underline">
            Activity
          </Link>
          .
        </div>
      </Card>
    </div>
    {history && (
      <Panel
        title="Sign-ins and security events"
        subtitle={`Where ${first} signed in from, failed codes, and two-step changes - newest first.`}
        bodyClassName=""
      >
        {history.items.length === 0 ? (
          <p className="border-t border-line px-4 py-4 text-[13px] text-ink-500 sm:px-5">Nothing recorded yet.</p>
        ) : (
          <div className="border-t border-line">
            <AuditList items={history.items} base="/overview" />
          </div>
        )}
      </Panel>
    )}
    </div>
  );
}
