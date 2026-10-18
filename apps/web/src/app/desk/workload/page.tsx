import { requireRole } from '@/lib/session';
import { apiFetch } from '@/lib/api';
import {
  Card,
  EmptyState,
  LinkButton,
  Meter,
  PageHeader,
  Panel,
  Pill,
  StatCard,
  loadTone,
} from '@/components/ui';
import { IconAlert, IconGlobe, IconInbox, IconUsers } from '@/components/icons';
import { can } from '@/lib/permissions';
import { MyIncentivesPanel } from '@/components/commissions/incentives-panel';

export const metadata = { title: 'My workload' };

interface Workload {
  id: string;
  name: string;
  countries: string[];
  activeClients: number;
  maxActiveClients: number;
  pendingReviews: number;
  stuckCases: number;
}

export default async function WorkloadPage() {
  const user = await requireRole('consultant');
  const me = await apiFetch<Workload | null>('/consultants/me');

  if (!me) {
    return (
      <Card>
        <EmptyState
          title="No consultant profile"
          description="Your account is not linked to a consultant profile yet. Ask your manager to set this up."
        />
      </Card>
    );
  }

  const load = Math.min(
    100,
    Math.round((me.activeClients / Math.max(1, me.maxActiveClients)) * 100),
  );

  return (
    <div>
      <PageHeader
        breadcrumb={[{ href: '/desk', label: 'Dashboard' }, { label: 'My workload' }]}
        title="My workload"
        subtitle="What is on your desk right now."
        actions={
          <LinkButton href="/desk/clients" variant="secondary">
            View clients
          </LinkButton>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Active clients"
          value={me.activeClients}
          tone="info"
          icon={<IconUsers size={18} />}
          hint={`of ${me.maxActiveClients} capacity`}
          href="/desk/clients"
        />
        <StatCard
          label="Documents to review"
          value={me.pendingReviews}
          tone={me.pendingReviews > 0 ? 'warn' : 'neutral'}
          icon={<IconInbox size={18} />}
          hint={me.pendingReviews > 0 ? 'clients waiting on you' : 'queue is clear'}
          href="/desk/reviews"
        />
        <StatCard
          label="Cases not moving"
          value={me.stuckCases}
          tone={me.stuckCases > 0 ? 'bad' : 'neutral'}
          icon={<IconAlert size={18} />}
          hint="past the limit for their stage"
          href="/desk"
        />
      </div>

      <div className="mt-5 grid items-start gap-5 sm:grid-cols-2">
        <Panel title="Capacity" subtitle={`${me.activeClients} of ${me.maxActiveClients} clients`}>
          <div className="flex items-center gap-3">
            <Meter value={load} tone={loadTone(load)} className="h-2 flex-1" label="Your workload" />
            <span className="tnum text-[15px] font-semibold text-ink-950">{load}%</span>
          </div>
          <p className="mt-2.5 text-[13px] leading-relaxed text-ink-500">
            {load > 90
              ? 'You are at capacity. Ask your manager before taking on more clients.'
              : load > 70
                ? 'Filling up. There is room for a few more before this needs a conversation.'
                : 'You have room for more clients.'}
          </p>
        </Panel>

        <Panel
          title="Your countries"
          subtitle="Destinations you are the assigned specialist for"
        >
          {me.countries.length === 0 ? (
            <p className="flex items-center gap-2 text-[13px] text-ink-500">
              <IconGlobe size={16} className="text-ink-400" />
              No countries assigned yet. Your manager sets these.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {me.countries.map((c) => (
                <Pill key={c} tone="neutral">
                  {c}
                </Pill>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <MyIncentivesPanel className="mt-5" commissionHref={can(user, 'commission.view') ? (id) => `/desk/commissions/${id}` : null} />
    </div>
  );
}
