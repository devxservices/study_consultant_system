import Link from 'next/link';
import {
  DOCUMENT_META,
  type AnnouncementView,
  type DocumentType,
  type DocumentView,
  type Paginated,
  type TaskView,
} from '@crm/shared';
import { enabledModules } from '@/lib/entitlements';
import { DeadlineList, type DeadlineItem } from '@/components/deadlines';
import { TaskList } from '@/components/tasks/task-list';
import { AnnouncementFeed } from '@/components/announcements';
import { apiFetch } from '@/lib/api';
import { requireRole } from '@/lib/session';
import { redirect } from 'next/navigation';
import { deskHome } from '@/lib/desk-home';
import { can } from '@/lib/permissions';
import {
  Avatar,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  Panel,
  PanelLink,
  Pill,
  StatCard,
  loadTone,
} from '@/components/ui';
import { RingMeter } from '@/components/charts/ring-meter';
import { Funnel, FunnelTable, type FunnelStage } from '@/components/funnel';
import { StuckCaseRow, type StuckCase } from '@/components/stuck-cases';
import { TrendAreaChart, type TrendPoint } from '@/components/charts/area-chart';
import { CaseHealthDonut, type HealthSegment } from '@/components/charts/donut';
import { Sparkline } from '@/components/charts/sparkline';
import { ActivityFeed, type ActivityItem } from '@/components/activity-feed';
import { IconAlert, IconCheck, IconInbox, IconPlus, IconUsers } from '@/components/icons';
import { relativeDays } from '@/lib/format';

export const metadata = { title: 'Dashboard' };

interface Workload {
  id: string;
  name: string;
  activeClients: number;
  maxActiveClients: number;
  pendingReviews: number;
  stuckCases: number;
}

interface Kpis {
  activeCases: number;
  stalledCases: number;
  approvedAllTime: number;
  pendingReviews: number;
  newClients30: number;
  newClientsDeltaPct: number | null;
  approved30: number;
  approvedDeltaPct: number | null;
  documentsCleared30: number;
  documentsClearedDeltaPct: number | null;
}

/**
 * The consultant's home screen.
 *
 * A consultant's day is driven by a queue, not by a report, so this page leads
 * with the two things that are actually waiting - documents to review and cases
 * that have stopped - and puts the charts underneath. The manager's version of
 * this page is the other way round, deliberately: they are looking at a
 * consultancy, not working a desk.
 */
export default async function DeskPage() {
  const user = await requireRole('consultant');

  const modules = await enabledModules();
  const home = deskHome(user, modules);
  if (home !== '/desk') redirect(home);
  const [followUps, deadlines, notices] = await Promise.all([
    modules.has('tasks')
      ? Promise.all([
          apiFetch<Paginated<TaskView>>('/tasks?view=overdue&assignee=me&pageSize=10'),
          apiFetch<Paginated<TaskView>>('/tasks?view=today&assignee=me&pageSize=10'),
        ]).then(([a, b]) => ({
          // A task due earlier today is both overdue and due today; show it once.
          items: [...a.items, ...b.items.filter((t) => !a.items.some((o) => o.id === t.id))],
          overdue: a.total,
          today: b.total,
        }))
      : Promise.resolve(null),
    apiFetch<DeadlineItem[]>('/analytics/deadlines?days=21').catch(() => [] as DeadlineItem[]),
    modules.has('announcements') ? apiFetch<AnnouncementView[]>('/announcements').catch(() => []) : Promise.resolve([] as AnnouncementView[]),
  ]);
  const [me, kpis, trends, health, funnel, stuck, pending, activity] = await Promise.all([
    apiFetch<Workload | null>('/consultants/me').catch(() => null),
    apiFetch<Kpis>('/analytics/kpis'),
    apiFetch<{ points: TrendPoint[] }>('/analytics/trends?months=6'),
    apiFetch<{ total: number; segments: HealthSegment[] }>('/analytics/health'),
    apiFetch<{ stages: FunnelStage[]; totalActive: number }>('/analytics/funnel'),
    apiFetch<Paginated<StuckCase>>('/analytics/stuck?pageSize=4'),
    can(user, 'document.view')
      ? apiFetch<Paginated<DocumentView>>('/documents?awaiting=true&pageSize=5&sort=oldest')
      : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 5, totalPages: 1 } as Paginated<DocumentView>),
    apiFetch<ActivityItem[]>('/analytics/activity?limit=7'),
  ]);

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
  const firstName = user.fullName.split(/\s+/)[0] ?? user.fullName;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        subtitle={
          pending.total > 0
            ? `${pending.total} document${pending.total === 1 ? '' : 's'} waiting on you.`
            : 'Nothing is waiting on you right now.'
        }
        actions={
          <>
            {can(user, 'document.view') && (
              <LinkButton href="/desk/reviews" variant="secondary">
                Review queue
              </LinkButton>
            )}
            {can(user, 'client.create') && (
              <LinkButton href="/desk/clients/new">
                <IconPlus size={16} />
                Add client
              </LinkButton>
            )}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
        <StatCard
          label="Active clients"
          value={me.activeClients}
          tone="info"
          icon={<IconUsers size={20} />}
          hint={`of ${me.maxActiveClients} capacity`}
          href="/desk/clients"
        />
        <StatCard
          label="Waiting on you"
          value={me.pendingReviews}
          tone={me.pendingReviews > 0 ? 'warn' : 'neutral'}
          icon={<IconInbox size={20} />}
          hint={me.pendingReviews > 0 ? 'documents to review' : 'queue is clear'}
          href="/desk/reviews"
        />
        <StatCard
          label="Not moving"
          value={me.stuckCases}
          tone={me.stuckCases > 0 ? 'bad' : 'neutral'}
          icon={<IconAlert size={20} />}
          hint="past the limit for their stage"
          href="/desk/clients"
        />
        <StatCard
          label="Visas approved"
          value={kpis.approved30}
          tone="ok"
          icon={<IconCheck size={20} />}
          hint={`${kpis.approvedAllTime} all time`}
          delta={
            kpis.approvedDeltaPct === null
              ? null
              : { pct: kpis.approvedDeltaPct, label: 'vs previous 30 days' }
          }
          chart={<Sparkline values={trends.points.map((p) => p.approved)} tone="ok" />}
        />
      </div>

      {/* What is actually waiting, before any chart. */}
      <div className="mt-5 grid items-start gap-5 xl:grid-cols-2">
        <Panel
          title="Review queue"
          subtitle={
            pending.total === 0
              ? 'Nothing waiting'
              : `${pending.total} document${pending.total === 1 ? '' : 's'}, oldest first`
          }
          action={pending.total > 5 ? <PanelLink href="/desk/reviews">See all</PanelLink> : null}
          bodyClassName="px-2 pb-3 sm:px-3"
        >
          {pending.items.length === 0 ? (
            <EmptyState
              compact
              title="Your queue is clear"
              description="New uploads from your clients will land here."
            />
          ) : (
            <ul>
              {pending.items.map((d) => (
                <li key={d.id}>
                  <Link
                    href={d.caseId ? `/desk/cases/${d.caseId}` : `/desk/documents?clientId=${d.clientId}&view=review`}
                    className="group flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-ink-50"
                  >
                    <Avatar name={d.clientName ?? 'Agency'} size={38} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-ink-950 transition-colors group-hover:text-brand-700">
                        {d.clientName}
                      </span>
                      <span className="block truncate text-[12px] text-ink-400">
                        {DOCUMENT_META[d.type as DocumentType]?.label ?? d.fileName} &middot; uploaded {relativeDays(d.uploadedAt)}
                      </span>
                    </span>
                    <Pill tone="warn">Pending</Pill>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Not moving"
          subtitle={
            stuck.total === 0
              ? 'Every case is inside its stage limit'
              : `${stuck.total} case${stuck.total === 1 ? '' : 's'} past the limit`
          }
          bodyClassName="pb-2"
        >
          {stuck.items.length === 0 ? (
            <div className="flex items-center gap-3 px-4 pb-4 sm:px-5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ok-50 text-ok-700">
                <IconCheck size={18} />
              </span>
              <div>
                <p className="text-[14px] font-medium text-ink-900">Everything is moving</p>
                <p className="text-[13px] text-ink-500">
                  No case of yours has sat past its stage limit.
                </p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {stuck.items.map((c) => (
                <StuckCaseRow
                  key={c.id}
                  item={c}
                  href={`/desk/cases/${c.id}`}
                  showConsultant={false}
                />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-2">
        {followUps && (
          <Panel
            title="Your follow-ups"
            subtitle={
              followUps.overdue + followUps.today === 0
                ? 'Nothing due today'
                : `${followUps.overdue} overdue · ${followUps.today} due today`
            }
            action={<PanelLink href="/desk/tasks">All tasks</PanelLink>}
            bodyClassName=""
          >
            <TaskList tasks={followUps.items} hrefBase="/desk" empty="Nothing overdue or due today." />
          </Panel>
        )}
        <Panel title="Coming up" subtitle="Deadlines and appointments on your cases" bodyClassName="pb-2">
          <DeadlineList items={deadlines} hrefBase="/desk" limit={7} />
        </Panel>
      </div>

      {notices.length > 0 && (
        <div className="mt-5">
          <Panel title="Announcements" bodyClassName="">
            <AnnouncementFeed items={notices.slice(0, 3)} compact />
          </Panel>
        </div>
      )}

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[1.55fr_1fr]">
        <Panel title="Your intake and outcomes" subtitle="Cases you opened against visas approved">
          <TrendAreaChart points={trends.points} />
        </Panel>

        <Panel title="Case health" subtitle="Your live cases, by who is holding them up">
          <CaseHealthDonut segments={health.segments} total={health.total} />
        </Panel>
      </div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[1.55fr_1fr]">
        <Panel title="Your pipeline" subtitle="Click a stage to see those clients.">
          <Funnel stages={funnel.stages} hrefBase="/desk/clients" />
          <FunnelTable stages={funnel.stages} />
        </Panel>

        <div className="space-y-5">
          <Panel
            title="Capacity"
            subtitle="How full your caseload is"
            action={<PanelLink href="/desk/workload">Detail</PanelLink>}
          >
            <div className="flex items-center gap-5">
              <RingMeter value={load} tone={loadTone(load)} size={112} label="Your workload" caption="used" />
              <div className="min-w-0">
                <p className="text-[22px] font-medium leading-tight text-ink-950">
                  {me.activeClients}
                  <span className="text-[14px] font-normal text-ink-400"> of {me.maxActiveClients} clients</span>
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">
                  {load > 90
                    ? 'You are at capacity. New clients should go to someone else.'
                    : load > 70
                      ? 'Filling up. There is room for a few more.'
                      : 'Comfortable. You can take on more clients.'}
                </p>
              </div>
            </div>
          </Panel>

          <Panel title="Recent activity" subtitle="On your cases">
            <ActivityFeed items={activity} caseHrefBase="/desk/cases" />
          </Panel>
        </div>
      </div>
    </>
  );
}

/**
 * Rendered on the server, so this is the server's clock. That is the right
 * answer for a single-office consultancy and the wrong one the day this is
 * deployed across time zones - at which point it moves to the client.
 */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
