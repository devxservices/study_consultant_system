import { requireRole } from '@/lib/session';
import { can } from '@/lib/permissions';
import { apiFetch } from '@/lib/api';
import { Card, EmptyState, LinkButton, PageHeader } from '@/components/ui';
import { NoAccess } from '@/components/no-access';
import { WorkloadCards, type ConsultantSummary } from '@/components/team/workload-cards';

export const metadata = { title: 'Team' };

/**
 * The team, for a consultant a manager has let see it - and, with "manage
 * consultants", add colleagues and help them back in. Permissions themselves
 * are never here: only managers change those.
 */
export default async function DeskTeamPage() {
  const user = await requireRole('consultant');
  if (!can(user, 'staff.view')) return <NoAccess title="Team" permission="staff.view" />;
  const manage = can(user, 'staff.manage');
  const consultants = await apiFetch<ConsultantSummary[]>(`/consultants${manage ? '?includeInactive=true' : ''}`);

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Everyone’s caseload, so work can be shared before anyone falls behind."
        actions={manage ? <LinkButton href="/desk/team/new">Add consultant</LinkButton> : undefined}
      />
      {consultants.length === 0 ? (
        <Card>
          <EmptyState title="No consultants yet" description="Consultant accounts will appear here." />
        </Card>
      ) : (
        <WorkloadCards
          consultants={consultants}
          clientsHref={can(user, 'client.view_all') ? (c) => `/desk/clients?consultantId=${c.id}` : undefined}
          canManage={manage}
        />
      )}
    </>
  );
}
