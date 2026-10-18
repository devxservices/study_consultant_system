import Link from 'next/link';
import { ROLE_LABEL, type TeamMember } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { relativeDays } from '@/lib/format';
import { Avatar, Card, EmptyState, LinkButton, PageHeader, Panel, PanelLink, Pill } from '@/components/ui';
import { WorkloadCards, type ConsultantSummary } from '@/components/team/workload-cards';

export const metadata = { title: 'Team' };

/**
 * The team, from the owner's side. Who can do what and how they sign in on
 * top; who is overloaded, who has room, and who is sitting on a review queue
 * below.
 */
export default async function ConsultantsPage() {
  const [consultants, team] = await Promise.all([
    apiFetch<ConsultantSummary[]>('/consultants?includeInactive=true'),
    apiFetch<TeamMember[]>('/team').catch(() => [] as TeamMember[]),
  ]);

  const header = (
    <PageHeader
      title="Team"
      subtitle="Who can do what, how they sign in, and whether anyone is quietly drowning."
      actions={
        <>
          <LinkButton href="/overview/security#defaults" variant="secondary">
            Default permissions
          </LinkButton>
          <LinkButton href="/overview/consultants/new">Add consultant</LinkButton>
        </>
      }
    />
  );

  const withoutTwoStep = team.filter((m) => m.active && !m.mfaEnabled).length;

  return (
    <>
      {header}

      {team.length > 0 && (
        <Panel
          title="Team access"
          subtitle={
            withoutTwoStep > 0
              ? `${withoutTwoStep} of ${team.filter((m) => m.active).length} active people sign in without two-step verification`
              : 'Everyone active signs in with two-step verification'
          }
          action={<PanelLink href="/overview/security">Security settings</PanelLink>}
          bodyClassName=""
          className="mb-5"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13.5px]">
              <thead>
                <tr className="border-y border-line text-[12.5px] font-medium text-ink-500">
                  <th className="px-4 py-2 sm:px-5">Person</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Two-step</th>
                  <th className="px-3 py-2">Permissions</th>
                  <th className="px-3 py-2">Last sign-in</th>
                  <th className="px-4 py-2 sm:px-5">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {team.map((m) => (
                  <tr key={m.userId} className={m.active ? undefined : 'opacity-60'}>
                    <td className="px-4 py-2.5 sm:px-5">
                      <Link href={`/overview/consultants/${m.userId}`} className="group flex items-center gap-2.5">
                        <Avatar name={m.name} size={32} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink-900 group-hover:text-brand-700">{m.name}</span>
                          <span className="block truncate text-[12px] text-ink-400">{m.email}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <Pill tone={m.role === 'manager' ? 'info' : 'neutral'}>{ROLE_LABEL[m.role]}</Pill>
                      {!m.active && <span className="ml-1.5 text-[12px] text-ink-400">login off</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {m.mfaEnabled ? (
                        <Pill tone="ok" dot>
                          On
                        </Pill>
                      ) : (
                        <Pill tone="warn" dot>
                          Off
                        </Pill>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-ink-600">
                      {m.role === 'manager'
                        ? 'Everything (owner)'
                        : m.overrides > 0
                          ? `${m.overrides} custom`
                          : 'Consultancy default'}
                    </td>
                    <td className="tnum px-3 py-2.5 text-ink-500">{relativeDays(m.lastSignInAt)}</td>
                    <td className="px-4 py-2.5 text-right sm:px-5">
                      <Link
                        href={`/overview/consultants/${m.userId}`}
                        className="text-[12.5px] font-medium text-brand-700 hover:underline"
                      >
                        {m.role === 'manager' ? 'Activity' : 'Manage access'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <h2 className="mb-3 text-[15.5px] font-medium text-ink-950">Workload</h2>
      {consultants.length === 0 ? (
        <Card>
          <EmptyState
            title="No consultants yet"
            description="Add consultant accounts to start assigning clients."
            action={<LinkButton href="/overview/consultants/new">Add a consultant</LinkButton>}
          />
        </Card>
      ) : (
        <WorkloadCards
          consultants={consultants}
          clientsHref={(c) => `/overview/clients?consultantId=${c.id}`}
          memberHref={(c) => `/overview/consultants/${c.userId}`}
          canManage
        />
      )}
    </>
  );
}
