import Link from 'next/link';
import {
  AUDIT_ACTION_LABEL,
  LEAD_SOURCE_LABEL,
  ROLE_LABEL,
  formatMoney,
  type AnnouncementView,
  type AuditAction,
  type BillingTotals,
  type LeadSource,
  type Role,
  type TaskCounts,
} from '@crm/shared';
import { enabledModules } from '@/lib/entitlements';
import { apiFetch } from '@/lib/api';
import { DeadlineList, type DeadlineItem } from '@/components/deadlines';
import { HBarList } from '@/components/charts/hbar-list';
import { RingMeter } from '@/components/charts/ring-meter';
import { Sparkline } from '@/components/charts/sparkline';
import { GeniusLineChart, LineLegend, type LineSeries, type TrendPoint } from '@/components/charts/genius-line-chart';
import { AnnouncementFeed } from '@/components/announcements';
import { actionTone } from '@/components/activity-feed';
import { SummaryList, type SummaryRow } from '@/components/summary-list';
import {
  Avatar,
  Delta,
  EmptyState,
  LinkButton,
  PageHeader,
  Panel,
  PanelLink,
  Pill,
  StatCard,
  cx,
  type Tone,
} from '@/components/ui';
import { IconAlert, IconCheck, IconClock, IconFile, IconInbox } from '@/components/icons';
import { GettingStarted } from '@/components/getting-started';

export const metadata = { title: 'Overview' };

const DOT: Record<Tone, string> = {
  ok: 'bg-ok-500',
  warn: 'bg-warn-500',
  bad: 'bg-bad-500',
  neutral: 'bg-ink-300',
  info: 'bg-info-500',
};

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

interface ActivityItem {
  id: string;
  action: string;
  caseId: string | null;
  clientId: string | null;
  clientName: string | null;
  actorName: string | null;
  actorRole: string | null;
  createdAt: string;
}

/**
 * The manager's morning screen: four headline figures, the case flow and how
 * much of it is on track, the money and follow-ups that need a decision, then
 * what is coming up and where clients come from. Every figure on it is live
 * data scoped by the API - nothing here is decorative.
 */
export default async function OverviewPage() {
  const modules = await enabledModules();
  const [kpis, trends, activity, deadlines, destinations, sources, money, tasks, notices] = await Promise.all([
    apiFetch<Kpis>('/analytics/kpis'),
    apiFetch<{ points: TrendPoint[] }>('/analytics/trends?months=10'),
    apiFetch<ActivityItem[]>('/analytics/activity?limit=8'),
    apiFetch<DeadlineItem[]>('/analytics/deadlines?days=30'),
    apiFetch<{ country: string; total: number; active: number; approved: number; rejected: number }[]>('/analytics/destinations'),
    apiFetch<{ source: string; clients: number; approved: number }[]>('/analytics/sources'),
    modules.has('billing') ? apiFetch<BillingTotals[]>('/billing/totals').catch(() => []) : Promise.resolve([] as BillingTotals[]),
    modules.has('tasks') ? apiFetch<TaskCounts>('/tasks/counts?scope=all').catch(() => null) : Promise.resolve(null),
    modules.has('announcements') ? apiFetch<AnnouncementView[]>('/announcements').catch(() => []) : Promise.resolve([] as AnnouncementView[]),
  ]);
  const cash = money[0];
  const week = deadlines.filter((d) => {
    const days = (new Date(`${d.date}T00:00:00`).getTime() - Date.now()) / 86_400_000;
    return days <= 7;
  }).length;

  // The three monthly case flows, in the validated series order (blue, teal,
  // coral). The chart carries a table view as well as its hover readout.
  const series: LineSeries[] = [
    { key: 'opened', label: 'Cases opened', color: 'var(--color-series-1)' },
    { key: 'approved', label: 'Visas approved', color: 'var(--color-series-2)' },
    { key: 'rejected', label: 'Visas refused', color: 'var(--color-series-3)' },
  ];

  // Two ratios, both computed from figures already on this page.
  const onTrack = kpis.activeCases
    ? ((kpis.activeCases - kpis.stalledCases) / kpis.activeCases) * 100
    : null;
  const approvedInPeriod = trends.points.reduce((n, p) => n + p.approved, 0);
  const decided = approvedInPeriod + trends.points.reduce((n, p) => n + p.rejected, 0);
  const approvalRate = decided ? (approvedInPeriod / decided) * 100 : null;
  const trackTone: Tone = onTrack === null ? 'neutral' : onTrack >= 85 ? 'ok' : onTrack >= 70 ? 'warn' : 'bad';

  const summary: SummaryRow[] = [
    ...(cash
      ? [
          {
            key: 'collected',
            label: 'Collected, last 30 days',
            value: formatMoney(cash.collected30, cash.currency),
            tone: 'ok' as const,
            href: '/overview/finance',
          },
          {
            key: 'owed',
            label: 'Owed to you',
            value: formatMoney(cash.outstanding, cash.currency),
            tone: 'info' as const,
            href: '/overview/finance/invoices?status=open',
          },
          ...(cash.overdue
            ? [
                {
                  key: 'overdue',
                  label: 'Of that, overdue',
                  value: formatMoney(cash.overdue, cash.currency),
                  tone: 'bad' as const,
                  href: '/overview/finance/invoices?status=open',
                },
              ]
            : []),
        ]
      : []),
    ...(tasks
      ? [
          {
            key: 'tasks',
            label: 'Overdue follow-ups',
            value: tasks.overdue,
            tone: (tasks.overdue ? 'bad' : 'neutral') as Tone,
            href: '/overview/tasks?view=overdue',
          },
        ]
      : []),
    {
      key: 'week',
      label: 'Deadlines this week',
      value: week,
      tone: week ? 'warn' : 'neutral',
    },
  ];

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Where the consultancy stands this morning."
        actions={
          <>
            <LinkButton href="/overview/stuck" variant="secondary">
              Review stalled cases
            </LinkButton>
            <LinkButton href="/overview/clients">Browse all clients</LinkButton>
          </>
        }
      />

      <GettingStarted />

      {/* Four headline figures. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
        <StatCard
          label="Active cases"
          value={kpis.activeCases}
          tone="info"
          icon={<IconInbox size={20} />}
          hint={`${kpis.newClients30} new client${kpis.newClients30 === 1 ? '' : 's'} in the last 30 days`}
          href="/overview/clients"
        />
        <StatCard
          label="Visas approved"
          value={kpis.approved30}
          tone="ok"
          icon={<IconCheck size={20} />}
          delta={kpis.approvedDeltaPct === null ? null : { pct: kpis.approvedDeltaPct, label: 'vs previous 30 days' }}
          hint={`${kpis.approvedAllTime} all time`}
          chart={<Sparkline values={trends.points.map((p) => p.approved)} tone="ok" />}
        />
        <StatCard
          label="Awaiting review"
          value={kpis.pendingReviews}
          tone={kpis.pendingReviews ? 'warn' : 'neutral'}
          icon={<IconClock size={20} />}
          hint={kpis.pendingReviews ? 'documents uploaded, not yet checked' : 'every upload has been checked'}
          href="/overview/clients"
        />
        <StatCard
          label="Stalled cases"
          value={kpis.stalledCases}
          tone={kpis.stalledCases ? 'bad' : 'neutral'}
          icon={<IconAlert size={20} />}
          hint={kpis.stalledCases ? 'past the time limit for their stage' : 'every case is moving'}
          href="/overview/stuck"
        />
      </div>

      {/* The flow of cases, and how much of it is on track. */}
      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[1.65fr_1fr]">
        <Panel
          title="Case flow"
          subtitle="Cases opened, approved and refused, by month"
          action={<LineLegend series={series} />}
        >
          <GeniusLineChart points={trends.points} series={series} />
        </Panel>

        <Panel title="At a glance" subtitle="Live cases and decisions">
          <div className="grid grid-cols-2 gap-4">
            <figure className="flex flex-col items-center rounded-xl bg-ink-50 px-3 py-4 text-center">
              {onTrack === null ? (
                <p className="py-10 text-[13px] text-ink-400">No live cases</p>
              ) : (
                <RingMeter value={onTrack} tone={trackTone} size={116} label="Live cases on track" />
              )}
              <figcaption className="mt-3">
                <span className="flex items-center justify-center gap-1.5 text-[13.5px] font-medium text-ink-900">
                  <span aria-hidden className={cx('size-2 rounded-full', DOT[trackTone])} />
                  On track
                </span>
                <span className="mt-0.5 block text-[12px] text-ink-400">
                  {kpis.activeCases - kpis.stalledCases} of {kpis.activeCases} live cases
                </span>
              </figcaption>
            </figure>
            <figure className="flex flex-col items-center rounded-xl bg-ink-50 px-3 py-4 text-center">
              {approvalRate === null ? (
                <p className="py-10 text-[13px] text-ink-400">No decisions yet</p>
              ) : (
                <RingMeter value={approvalRate} tone="info" size={116} label="Visa approval rate" />
              )}
              <figcaption className="mt-3">
                <span className="flex items-center justify-center gap-1.5 text-[13.5px] font-medium text-ink-900">
                  <span aria-hidden className="size-2 rounded-full bg-[var(--color-series-1)]" />
                  Approval rate
                </span>
                <span className="mt-0.5 block text-[12px] text-ink-400">
                  {approvedInPeriod} of {decided} decisions, {trends.points.length} months
                </span>
              </figcaption>
            </figure>
          </div>

          <dl className="mt-4 divide-y divide-line">
            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="min-w-0">
                <span className="block text-[13.5px] text-ink-700">New clients</span>
                {kpis.newClientsDeltaPct !== null && (
                  <Delta pct={kpis.newClientsDeltaPct} label="vs previous 30 days" />
                )}
              </dt>
              <dd className="text-[22px] font-medium text-ink-950">{kpis.newClients30}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 pt-3">
              <dt className="min-w-0">
                <span className="block text-[13.5px] text-ink-700">Documents cleared</span>
                {kpis.documentsClearedDeltaPct !== null && (
                  <Delta pct={kpis.documentsClearedDeltaPct} label="vs previous 30 days" />
                )}
              </dt>
              <dd className="text-[22px] font-medium text-ink-950">{kpis.documentsCleared30}</dd>
            </div>
          </dl>
        </Panel>
      </div>

      {/* What needs a decision, beside what has just happened. */}
      <div className="mt-5 grid items-start gap-5 xl:grid-cols-3">
        <Panel title="Summary" subtitle={modules.has('billing') ? 'Money, follow-ups and dates' : 'Follow-ups and dates'}>
          <SummaryList rows={summary} />
        </Panel>

        <Panel
          title="Recent activity"
          subtitle="The latest actions across every consultant"
          action={<PanelLink href="/overview/audit">Audit trail</PanelLink>}
          bodyClassName="pb-2"
          className="xl:col-span-2"
        >
          {activity.length === 0 ? (
            <div className="px-4 pb-4 sm:px-5">
              <EmptyState
                compact
                title="Nothing has happened yet"
                description="Uploads, reviews and stage changes will appear here."
              />
            </div>
          ) : (
            <ActivityTable items={activity} />
          )}
        </Panel>
      </div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-3">
        <Panel title="Coming up" subtitle="The next 30 days, soonest first" bodyClassName="pb-2">
          <DeadlineList items={deadlines} hrefBase="/overview" showConsultant />
        </Panel>

        <Panel title="Destinations" subtitle="Applications per country, and how they ended">
          <HBarList
            rows={destinations.slice(0, 6).map((d) => ({
              key: d.country,
              label: d.country,
              value: d.total,
              note: `${d.active} in progress · ${d.approved} approved · ${d.rejected} refused`,
            }))}
          />
        </Panel>

        <Panel title="Where clients come from" subtitle="Enquiries by source, and how many became a visa">
          <HBarList
            rows={sources.slice(0, 6).map((r) => ({
              key: r.source,
              label: r.source === 'unknown' ? 'Not recorded' : (LEAD_SOURCE_LABEL[r.source as LeadSource] ?? r.source),
              value: r.clients,
              note: r.clients ? `${r.approved} approved · ${Math.round((r.approved / r.clients) * 100)}% conversion` : undefined,
            }))}
          />
        </Panel>
      </div>

      {notices.length > 0 && (
        <div className="mt-5">
          <Panel
            title="Announcements"
            subtitle="For staff and for everyone"
            action={<PanelLink href="/overview/announcements">Manage</PanelLink>}
            bodyClassName=""
          >
            <AnnouncementFeed items={notices.slice(0, 3)} compact />
          </Panel>
        </div>
      )}
    </>
  );
}

function ActivityTable({ items }: { items: ActivityItem[] }) {
  return (
    <div className="scroll-x">
      <table className="w-full min-w-[680px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line text-[12.5px] text-ink-500">
            <th scope="col" className="px-4 pb-2.5 font-medium sm:px-5">Person</th>
            <th scope="col" className="px-3 pb-2.5 font-medium">Client</th>
            <th scope="col" className="px-3 pb-2.5 font-medium">Date &amp; time</th>
            <th scope="col" className="px-4 pb-2.5 font-medium sm:px-5">Activity</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((it) => {
            const label = AUDIT_ACTION_LABEL[it.action as AuditAction] ?? it.action;
            return (
              <tr key={it.id} className="transition-colors hover:bg-ink-50">
                <td className="px-4 py-3 sm:px-5">
                  {it.actorName ? (
                    <span className="flex items-center gap-3">
                      <Avatar name={it.actorName} size={34} />
                      <span className="min-w-0">
                        <span className="block whitespace-nowrap text-[13.5px] font-medium text-ink-950">
                          {it.actorName}
                        </span>
                        {it.actorRole && (
                          <span className="block text-[12px] text-ink-400">
                            {ROLE_LABEL[it.actorRole as Role] ?? it.actorRole}
                          </span>
                        )}
                      </span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-3 text-[13.5px] text-ink-500">
                      <span className="flex size-[34px] items-center justify-center rounded-full bg-ink-100 text-ink-400">
                        <IconFile size={16} />
                      </span>
                      System
                    </span>
                  )}
                </td>
                <td className="px-3 py-3">
                  {it.caseId ? (
                    <Link
                      href={`/overview/cases/${it.caseId}`}
                      className="block text-[13.5px] text-ink-900 transition-colors hover:text-brand-700"
                    >
                      {it.clientName ?? 'Case'}
                      <span className="block font-mono text-[11.5px] text-ink-400">#{it.caseId.slice(0, 8)}</span>
                    </Link>
                  ) : (
                    <span className="text-[13.5px] text-ink-700">{it.clientName ?? '--'}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-[13px] text-ink-600">
                  {formatDateTime(it.createdAt)}
                </td>
                <td className="px-4 py-3 sm:px-5">
                  <Pill tone={actionTone(it.action)}>{label}</Pill>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
