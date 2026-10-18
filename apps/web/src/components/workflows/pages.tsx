import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AUTOMATION_TRIGGER_LABEL,
  STAGE_DEFINITIONS,
  describeAction,
  describeCondition,
  type AuthUser,
  type AutomationRuleView,
  type AutomationRunView,
  type BoardView,
  type CountryView,
  type DocumentTypeView,
  type Paginated,
  type WorkflowDetailView,
  type WorkflowPerformanceView,
  type WorkflowStageView,
  type WorkflowSummaryView,
} from '@crm/shared';
import { apiFetch, ApiError, qs } from '@/lib/api';
import { can } from '@/lib/permissions';
import { formatDate, relativeDays } from '@/lib/format';
import { ActionButton } from '../forms';
import { NoAccess } from '../no-access';
import { Card, EmptyState, LinkButton, PageHeader, Pill, cx } from '../ui';
import { IconPlus } from '../icons';
import { AutomationEditor, type WorkflowStagesOption } from './automation-editor';
import { Board } from './board';
import { CountryForm } from './country-form';
import { StageBuilder, STAGE_COLOR_DOT } from './stage-builder';
import { NewWorkflowButton, WorkflowDetailsForm } from './workflow-forms';

type Base = '/overview' | '/desk';

/** Building workflows, automations and country data. Managers always may. */
export const canBuild = (user: AuthUser) => user.role === 'manager' || can(user, 'workflow.manage');

async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
}

function Tabs({ base, active, build }: { base: Base; active: 'workflows' | 'automations' | 'runs' | 'countries'; build: boolean }) {
  const tabs = [
    { key: 'workflows', label: 'Workflows', href: `${base}/workflows` },
    ...(build
      ? [
          { key: 'automations', label: 'Automations', href: `${base}/workflows/automations` },
          { key: 'runs', label: 'Run log', href: `${base}/workflows/automations/runs` },
        ]
      : []),
    { key: 'countries', label: 'Countries', href: `${base}/countries` },
  ];
  return (
    <nav className="-mb-px mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Workflows">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? 'page' : undefined}
          className={cx(
            'whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-[13.5px] font-medium',
            active === t.key ? 'border-brand-600 text-ink-950' : 'border-transparent text-ink-500 hover:text-ink-800',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Workflows                                                           */
/* ------------------------------------------------------------------ */

export async function WorkflowsIndexPage({ user, base }: { user: AuthUser; base: Base }) {
  const build = canBuild(user);
  const [workflows, countries] = await Promise.all([
    apiFetch<WorkflowSummaryView[]>(`/workflows${build ? '?includeArchived=true' : ''}`),
    apiFetch<CountryView[]>('/countries'),
  ]);
  const flags = new Map(countries.map((c) => [c.name.toLowerCase(), c.flag]));
  const live = workflows.filter((w) => !w.archived);
  const archived = workflows.filter((w) => w.archived);

  return (
    <>
      <PageHeader
        title="Workflows"
        subtitle="The stages each kind of application goes through - per destination, level and visa route - with their documents, gates, tasks, fees and messages."
        actions={build ? <NewWorkflowButton base={base} countries={countries.map((c) => c.name)} workflows={live} /> : undefined}
      />
      <Tabs base={base} active="workflows" build={build} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {live.map((w) => (
          <WorkflowCardLink key={w.id} w={w} base={base} flag={w.country ? flags.get(w.country.toLowerCase()) : undefined} />
        ))}
      </div>
      {archived.length > 0 && (
        <>
          <h2 className="mb-2 mt-8 text-[13px] font-semibold uppercase tracking-wide text-ink-400">Archived</h2>
          <div className="grid gap-3 opacity-80 md:grid-cols-2 xl:grid-cols-3">
            {archived.map((w) => (
              <WorkflowCardLink key={w.id} w={w} base={base} />
            ))}
          </div>
        </>
      )}
      <p className="mt-6 max-w-3xl text-[12.5px] leading-relaxed text-ink-400">
        A new application runs on the most specific workflow that fits it: one for its country, level and visa type beats one for its country alone, and
        Standard takes the rest. Each stage counts as one of the ten standard steps, so dashboards, funnels and reports compare like with like across
        countries.
      </p>
    </>
  );
}

function WorkflowCardLink({ w, base, flag }: { w: WorkflowSummaryView; base: Base; flag?: string }) {
  return (
    <Link href={`${base}/workflows/${w.id}`} className="lift press block rounded-xl bg-paper p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink-950">
            {flag && <span className="mr-1.5">{flag}</span>}
            {w.name}
          </p>
          <p className="mt-0.5 truncate text-[12.5px] text-ink-500">
            {[w.country ?? (w.isDefault ? 'Every other application' : 'Any country'), w.studyLevel, w.visaType].filter(Boolean).join(' · ')}
          </p>
        </div>
        {w.isDefault ? <Pill tone="neutral">Fallback</Pill> : w.archived ? <Pill tone="neutral">Archived</Pill> : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[12.5px] text-ink-500">
        {w.current ? (
          <span>
            Version {w.current.version} · {w.current.stageCount} stages
          </span>
        ) : (
          <Pill tone="warn">Not published</Pill>
        )}
        {w.draft && w.current && <Pill tone="info">Unpublished changes</Pill>}
        <span className="ml-auto tnum">
          {w.activeCases} open · {w.totalCases} total
        </span>
      </div>
    </Link>
  );
}

export async function WorkflowDetailPage({
  user,
  base,
  id,
  tab: rawTab,
  version,
}: {
  user: AuthUser;
  base: Base;
  id: string;
  tab?: string;
  version?: string;
}) {
  const build = canBuild(user);
  const tab = ['stages', 'versions', 'performance', 'details'].includes(rawTab ?? '') ? rawTab! : 'stages';
  const [detail, types, performance, olderVersion, countries] = await Promise.all([
    orNotFound(apiFetch<WorkflowDetailView>(`/workflows/${id}`)),
    tab === 'stages' ? apiFetch<DocumentTypeView[]>('/drive/types') : Promise.resolve(null),
    tab === 'performance' ? apiFetch<WorkflowPerformanceView>(`/workflows/${id}/performance`) : Promise.resolve(null),
    tab === 'versions' && version ? apiFetch<{ version: number; status: string; stages: WorkflowStageView[] }>(`/workflows/versions/${version}`).catch(() => null) : Promise.resolve(null),
    tab === 'details' ? apiFetch<CountryView[]>('/countries') : Promise.resolve(null),
  ]);
  const olderOpen = detail.versions.filter((v) => v.status !== 'published' && v.status !== 'draft').reduce((n, v) => n + v.activeCaseCount, 0);
  const tabs = [
    { key: 'stages', label: 'Stages' },
    { key: 'versions', label: `Versions (${detail.versions.filter((v) => v.status !== 'draft').length})` },
    { key: 'performance', label: 'Performance' },
    { key: 'details', label: 'Details' },
  ];

  return (
    <>
      <PageHeader
        title={detail.name}
        subtitle={[
          detail.country ?? (detail.isDefault ? 'Every application no other workflow fits' : 'Any country'),
          detail.studyLevel,
          detail.visaType,
          detail.current ? `version ${detail.current.version}` : 'not published',
          `${detail.activeCases} open applications`,
        ]
          .filter(Boolean)
          .join(' · ')}
        breadcrumb={[{ href: `${base}/workflows`, label: 'Workflows' }, { label: detail.name }]}
        actions={
          <LinkButton href={`${base}/pipeline?templateId=${detail.id}`} variant="secondary">
            Open board
          </LinkButton>
        }
      />
      <nav className="-mb-px mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Workflow">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`${base}/workflows/${id}${t.key === 'stages' ? '' : `?tab=${t.key}`}`}
            aria-current={tab === t.key ? 'page' : undefined}
            className={cx(
              'whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-[13.5px] font-medium',
              tab === t.key ? 'border-brand-600 text-ink-950' : 'border-transparent text-ink-500 hover:text-ink-800',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'stages' && (
        <StageBuilder
          key={`${detail.draft?.updatedAt ?? ''}${detail.current?.versionId ?? ''}`}
          workflowId={detail.id}
          initial={detail.draftStages ?? detail.currentStages ?? []}
          hasDraft={Boolean(detail.draft)}
          hasPublished={Boolean(detail.current)}
          draftNotes={detail.draftNotes}
          documentTypes={(types ?? []).filter((t) => t.active).map((t) => ({ key: t.key, label: t.label }))}
          canEdit={build}
          openOnOlderVersions={olderOpen}
        />
      )}

      {tab === 'versions' && (
        <div className="space-y-4">
          <Card className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-ink-50 text-left text-[11.5px] uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Version</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Published</th>
                  <th className="px-4 py-2 font-medium">What changed</th>
                  <th className="px-4 py-2 text-right font-medium">Applications</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {detail.versions.map((v) => (
                  <tr key={v.id} className="border-t border-line">
                    <td className="tnum px-4 py-2.5 font-medium text-ink-900">v{v.version}</td>
                    <td className="px-4 py-2.5">
                      <Pill tone={v.status === 'published' ? 'ok' : v.status === 'draft' ? 'info' : 'neutral'}>
                        {v.status === 'published' ? 'Current' : v.status === 'draft' ? 'Draft' : 'Earlier'}
                      </Pill>
                    </td>
                    <td className="px-4 py-2.5 text-ink-600">
                      {v.publishedAt ? `${formatDate(v.publishedAt)}${v.publishedByName ? ` by ${v.publishedByName}` : ''}` : '-'}
                    </td>
                    <td className="max-w-xs truncate px-4 py-2.5 text-ink-600">{v.notes ?? '-'}</td>
                    <td className="tnum px-4 py-2.5 text-right text-ink-700">
                      {v.activeCaseCount} open · {v.caseCount}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {v.status !== 'draft' && (
                        <Link className="text-brand-700 hover:underline" href={`${base}/workflows/${id}?tab=versions&version=${v.id}`}>
                          View stages
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {olderVersion && (
            <Card className="p-4 sm:p-5">
              <h2 className="mb-3 text-[15px] font-medium text-ink-950">Version {olderVersion.version}, as published</h2>
              <StageList stages={olderVersion.stages} />
            </Card>
          )}
          <p className="text-[12.5px] text-ink-400">
            Published versions never change. Applications stay on the version they started on until someone moves them - from the application, or when
            publishing with “move open applications”.
          </p>
        </div>
      )}

      {tab === 'performance' && performance && <Performance perf={performance} />}

      {tab === 'details' && countries && (
        <WorkflowDetailsForm workflow={detail} countries={countries.map((c) => c.name)} canEdit={build} />
      )}
    </>
  );
}

function StageList({ stages }: { stages: WorkflowStageView[] }) {
  return (
    <ol className="space-y-2">
      {stages.map((s, i) => (
        <li key={s.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-2 text-[13px] last:border-0">
          <span className="tnum w-5 text-right text-ink-400">{i + 1}</span>
          <span className={cx('size-2 rounded-full', STAGE_COLOR_DOT[s.color])} aria-hidden />
          <span className="font-medium text-ink-900">{s.name}</span>
          <span className="text-ink-500">{STAGE_DEFINITIONS[s.category].label}</span>
          <span className="text-ink-400">{s.slaDays}d</span>
          {s.requiredDocuments.length > 0 && <span className="text-ink-400">{s.requiredDocuments.length} documents</span>}
          {s.approvalRequired && <Pill tone="warn">Sign-off</Pill>}
          {s.movableBy === 'managers' && <Pill tone="neutral">Managers move</Pill>}
          {s.conditions.length > 0 && <span className="text-ink-400">only when {s.conditions.map(describeCondition).join(' and ').toLowerCase()}</span>}
        </li>
      ))}
    </ol>
  );
}

function Performance({ perf }: { perf: WorkflowPerformanceView }) {
  const maxReached = Math.max(1, ...perf.stages.map((s) => s.reached));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Started', value: perf.totals.started },
          { label: 'Open now', value: perf.totals.active },
          { label: 'Past their limit', value: perf.totals.overdue, tone: perf.totals.overdue ? 'text-bad-700' : '' },
          { label: 'Finished', value: perf.totals.closed },
        ].map((t) => (
          <Card key={t.label} className="p-4">
            <p className="text-[12px] text-ink-500">{t.label}</p>
            <p className={cx('tnum mt-1 text-[22px] font-semibold text-ink-950', t.tone)}>{t.value}</p>
          </Card>
        ))}
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-ink-50 text-left text-[11.5px] uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-2 font-medium">Stage</th>
              <th className="px-4 py-2 font-medium">Reached</th>
              <th className="px-4 py-2 text-right font-medium">Open now</th>
              <th className="px-4 py-2 text-right font-medium">Overdue</th>
              <th className="px-4 py-2 text-right font-medium">Typical time</th>
              <th className="px-4 py-2 text-right font-medium">Limit</th>
              <th className="px-4 py-2 text-right font-medium">Over the limit</th>
            </tr>
          </thead>
          <tbody>
            {perf.stages.map((s) => (
              <tr key={s.key} className="border-t border-line">
                <td className="px-4 py-2.5 font-medium text-ink-900">{s.name}</td>
                <td className="w-56 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                      <div className="h-full origin-left rounded-full bg-brand-500" style={{ transform: `scaleX(${s.reached / maxReached})` }} />
                    </div>
                    <span className="tnum w-8 text-right text-ink-700">{s.reached}</span>
                  </div>
                </td>
                <td className="tnum px-4 py-2.5 text-right text-ink-700">{s.active}</td>
                <td className={cx('tnum px-4 py-2.5 text-right', s.overdue ? 'font-medium text-bad-700' : 'text-ink-400')}>{s.overdue}</td>
                <td className="tnum px-4 py-2.5 text-right text-ink-700">{s.medianDays === null ? '-' : `${s.medianDays}d`}</td>
                <td className="tnum px-4 py-2.5 text-right text-ink-500">{s.slaDays}d</td>
                <td className={cx('tnum px-4 py-2.5 text-right', (s.breachRate ?? 0) > 0.25 ? 'font-medium text-bad-700' : 'text-ink-600')}>
                  {s.breachRate === null ? '-' : `${Math.round(s.breachRate * 100)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-[12.5px] text-ink-400">
        “Typical time” is the median of finished visits to the stage; “over the limit” is the share of those that took longer than the stage’s limit.
        Counted across every version of this workflow, by stage key.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Automations                                                         */
/* ------------------------------------------------------------------ */

export async function AutomationsPage({ user, base }: { user: AuthUser; base: Base }) {
  if (!canBuild(user)) return <NoAccess title="Automations" permission="workflow.manage" />;
  const rules = await apiFetch<AutomationRuleView[]>('/automations');
  return (
    <>
      <PageHeader
        title="Automations"
        subtitle="When something happens to an application, and these conditions hold, do these things - and log what was done."
        actions={
          <LinkButton href={`${base}/workflows/automations/new`}>
            <IconPlus size={16} />
            New automation
          </LinkButton>
        }
      />
      <Tabs base={base} active="automations" build />
      {rules.length === 0 ? (
        <Card>
          <EmptyState
            title="No automations yet"
            description="Create tasks, send messages, or move applications on automatically - when they enter a stage, a document is approved, or one stops moving."
            action={<LinkButton href={`${base}/workflows/automations/new`}>Create the first one</LinkButton>}
          />
        </Card>
      ) : (
        <ul className="space-y-2">
          {rules.map((r) => (
            <li key={r.id}>
              <Card className="flex flex-wrap items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`${base}/workflows/automations/${r.id}`} className="text-[14.5px] font-medium text-ink-950 hover:text-brand-700">
                      {r.name}
                    </Link>
                    <Pill tone={r.enabled ? 'ok' : 'neutral'} dot={r.enabled}>
                      {r.enabled ? 'On' : 'Off'}
                    </Pill>
                  </div>
                  <p className="mt-1 text-[13px] text-ink-600">
                    <span className="font-medium">When</span> {AUTOMATION_TRIGGER_LABEL[r.trigger].toLowerCase()}
                    {r.stageKey ? ` (${r.stageKey})` : ''}
                    {r.documentType ? ` (${r.documentType})` : ''}
                    {r.workflowName ? ` on ${r.workflowName}` : ''}
                    {r.conditions.length > 0 && <>, if {r.conditions.map(describeCondition).join(' and ').toLowerCase()}</>}
                  </p>
                  <ul className="mt-1 list-inside list-disc text-[12.5px] text-ink-500">
                    {r.actions.map((a, i) => (
                      <li key={i}>{describeAction(a)}</li>
                    ))}
                  </ul>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5 text-right text-[12px] text-ink-400">
                  <span>
                    Ran {r.runCount} time{r.runCount === 1 ? '' : 's'}
                    {r.lastRunAt ? `, last ${relativeDays(r.lastRunAt)}` : ''}
                  </span>
                  <span className="flex gap-1.5">
                    <Link href={`${base}/workflows/automations/runs?ruleId=${r.id}`} className="text-brand-700 hover:underline">
                      Run log
                    </Link>
                  </span>
                  <ActionButton url={`/api/automations/${r.id}/${r.enabled ? 'disable' : 'enable'}`} variant="ghost">
                    {r.enabled ? 'Switch off' : 'Switch on'}
                  </ActionButton>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export async function AutomationEditPage({ user, base, id }: { user: AuthUser; base: Base; id?: string }) {
  if (!canBuild(user)) return <NoAccess title="Automations" permission="workflow.manage" />;
  const [rule, list, types] = await Promise.all([
    id ? orNotFound(apiFetch<AutomationRuleView>(`/automations/${id}`)) : Promise.resolve(null),
    apiFetch<WorkflowSummaryView[]>('/workflows'),
    apiFetch<DocumentTypeView[]>('/drive/types'),
  ]);
  const details = await Promise.all(list.map((w) => apiFetch<WorkflowDetailView>(`/workflows/${w.id}`)));
  const workflows: WorkflowStagesOption[] = details.map((d) => ({
    id: d.id,
    name: d.name,
    stages: (d.currentStages ?? d.draftStages ?? []).map((s) => ({ key: s.key, name: s.name })),
  }));
  return (
    <>
      <PageHeader
        title={rule ? rule.name : 'New automation'}
        breadcrumb={[{ href: `${base}/workflows/automations`, label: 'Automations' }, { label: rule ? 'Edit' : 'New' }]}
      />
      <AutomationEditor base={base} initial={rule} workflows={workflows} documentTypes={types.filter((t) => t.active).map((t) => ({ key: t.key, label: t.label }))} />
    </>
  );
}

const RUN_TONE = { done: 'ok', partial: 'warn', failed: 'bad', skipped: 'neutral' } as const;
const RUN_LABEL = { done: 'Done', partial: 'Partly done', failed: 'Failed', skipped: 'Stopped' } as const;

export async function RunLogPage({ user, base, query }: { user: AuthUser; base: Base; query: { page?: string; ruleId?: string; status?: string } }) {
  if (!canBuild(user)) return <NoAccess title="Run log" permission="workflow.manage" />;
  const page = Math.max(1, Number(query.page) || 1);
  const runs = await apiFetch<Paginated<AutomationRunView>>(`/automations/runs${qs({ page, pageSize: 30, ruleId: query.ruleId, status: query.status })}`);
  const link = (p: Record<string, string | undefined>) => `${base}/workflows/automations/runs${qs({ ruleId: query.ruleId, status: query.status, ...p })}`;
  return (
    <>
      <PageHeader title="Run log" subtitle="Every time an automation or a stage’s own actions ran, and what each action did." />
      <Tabs base={base} active="runs" build />
      <div className="mb-3 flex flex-wrap gap-1.5 text-[12.5px]">
        {(['', 'done', 'partial', 'failed', 'skipped'] as const).map((s) => (
          <Link
            key={s || 'all'}
            href={link({ status: s || undefined, page: undefined })}
            className={cx('rounded-full px-2.5 py-1 ring-1', (query.status ?? '') === s ? 'bg-ink-900 text-paper ring-ink-900' : 'text-ink-600 ring-line hover:bg-ink-50')}
          >
            {s ? RUN_LABEL[s] : 'All'}
          </Link>
        ))}
        {query.ruleId && (
          <Link href={link({ ruleId: undefined, page: undefined })} className="rounded-full px-2.5 py-1 text-brand-700 ring-1 ring-brand-200">
            One automation × show all
          </Link>
        )}
      </div>
      {runs.items.length === 0 ? (
        <Card>
          <EmptyState title="Nothing has run yet" description="Runs appear here as applications move, documents are reviewed and the stuck-case check runs." />
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          {runs.items.map((r) => (
            <div key={r.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <Pill tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status]}</Pill>
                <span className="font-medium text-ink-900">{r.ruleName}</span>
                <span className="text-ink-400">· {AUTOMATION_TRIGGER_LABEL[r.trigger].toLowerCase()}</span>
                {r.caseId && (
                  <Link href={`${base}/cases/${r.caseId}`} className="text-brand-700 hover:underline">
                    {r.clientName} · {r.caseReference}
                  </Link>
                )}
                <span className="ml-auto text-[12px] text-ink-400">{new Date(r.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <ul className="mt-1.5 space-y-0.5 text-[12.5px]">
                {r.results.map((x, i) => (
                  <li key={i} className={x.ok ? 'text-ink-600' : 'text-bad-700'}>
                    {x.ok ? '✓' : '✕'} {x.detail}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>
      )}
      {runs.totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-[13px] text-ink-500">
          <span>
            Page {runs.page} of {runs.totalPages}
          </span>
          <span className="flex gap-2">
            {runs.page > 1 && <Link href={link({ page: String(runs.page - 1) })} className="text-brand-700 hover:underline">Newer</Link>}
            {runs.page < runs.totalPages && <Link href={link({ page: String(runs.page + 1) })} className="text-brand-700 hover:underline">Older</Link>}
          </span>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Countries                                                           */
/* ------------------------------------------------------------------ */

export async function CountriesPage({ user, base }: { user: AuthUser; base: Base }) {
  const build = canBuild(user);
  const [countries, unlisted] = await Promise.all([
    apiFetch<CountryView[]>(`/countries${build ? '?includeInactive=true' : ''}`),
    build ? apiFetch<{ name: string; caseCount: number }[]>('/countries/unlisted') : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader
        title="Countries"
        subtitle="What you know about each destination: intakes, fees, funds, tests and visa routes."
        actions={
          build ? (
            <LinkButton href={`${base}/countries/new`}>
              <IconPlus size={16} />
              Add country
            </LinkButton>
          ) : undefined
        }
      />
      <Tabs base={base} active="countries" build={build} />
      {countries.length === 0 ? (
        <Card>
          <EmptyState title="No countries yet" description={build ? 'Add the destinations you send students to.' : 'Your managers have not added any destinations yet.'} />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {countries.map((c) => (
            <Link key={c.id} href={`${base}/countries/${c.id}`} className={cx('lift press block rounded-xl bg-paper p-4 shadow-card', !c.active && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-[15px] font-medium text-ink-950">
                  <span className="mr-1.5 text-[18px]">{c.flag}</span>
                  {c.name}
                </p>
                {!c.active && <Pill tone="neutral">Hidden</Pill>}
              </div>
              <dl className="mt-2 space-y-1 text-[12.5px] text-ink-600">
                {c.intakes.length > 0 && (
                  <div>
                    <dt className="inline text-ink-400">Intakes: </dt>
                    <dd className="inline">{c.intakes.map((i) => i.name).join(', ')}</dd>
                  </div>
                )}
                {c.languageRequirements[0] && (
                  <div>
                    <dt className="inline text-ink-400">Tests: </dt>
                    <dd className="inline">{c.languageRequirements.map((l) => `${l.test} ${l.overall}`).join(', ')}</dd>
                  </div>
                )}
                {c.visaTypes.length > 0 && (
                  <div>
                    <dt className="inline text-ink-400">Visa: </dt>
                    <dd className="inline">{c.visaTypes.join(', ')}</dd>
                  </div>
                )}
              </dl>
              <p className="mt-3 border-t border-line pt-2.5 text-[12px] text-ink-500">
                {c.activeCaseCount} open · {c.caseCount} applications · {c.workflowCount} workflow{c.workflowCount === 1 ? '' : 's'} · {c.checklistCount} checklist
                {c.checklistCount === 1 ? '' : 's'}
              </p>
            </Link>
          ))}
        </div>
      )}
      {unlisted.length > 0 && (
        <Card className="mt-5 p-4">
          <p className="text-[13.5px] font-medium text-ink-900">Students are applying to destinations you have not described yet</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {unlisted.map((u) => (
              <Link key={u.name} href={`${base}/countries/new?name=${encodeURIComponent(u.name)}`} className="rounded-full bg-ink-50 px-2.5 py-1 text-[12.5px] text-ink-700 ring-1 ring-line hover:bg-brand-50">
                {u.name} · {u.caseCount}
              </Link>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

export async function CountryEditPage({ user, base, id, name }: { user: AuthUser; base: Base; id?: string; name?: string }) {
  const build = canBuild(user);
  if (!id && !build) return <NoAccess title="Add a country" permission="workflow.manage" />;
  const country = id ? await orNotFound(apiFetch<CountryView>(`/countries/${id}`)) : null;
  return (
    <>
      <PageHeader
        title={country ? `${country.flag} ${country.name}` : 'Add a country'}
        subtitle={country ? `${country.activeCaseCount} open applications · updated ${formatDate(country.updatedAt)}` : undefined}
        breadcrumb={[{ href: `${base}/countries`, label: 'Countries' }, { label: country ? country.name : 'New' }]}
        actions={
          country && country.workflowCount > 0 ? (
            <LinkButton href={`${base}/pipeline?country=${encodeURIComponent(country.name)}`} variant="secondary">
              Open board
            </LinkButton>
          ) : undefined
        }
      />
      <CountryForm base={base} initial={country} suggestedName={name} canEdit={build} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The board                                                           */
/* ------------------------------------------------------------------ */

export async function BoardPage({
  user,
  base,
  query,
}: {
  user: AuthUser;
  base: Base;
  query: { templateId?: string; country?: string; consultantId?: string; q?: string; perColumn?: string };
}) {
  const everyone = user.role === 'manager' || can(user, 'client.view_all');
  const [board, consultants] = await Promise.all([
    orNotFound(
      apiFetch<BoardView>(
        `/workflows/board${qs({ templateId: query.templateId, country: query.country, consultantId: query.consultantId, q: query.q, perColumn: query.perColumn })}`,
      ),
    ),
    everyone
      ? apiFetch<{ id: string; fullName: string }[]>('/consultants').catch(() => [] as { id: string; fullName: string }[])
      : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle={`${board.workflow.name}${board.workflow.country ? ` · ${board.workflow.country}` : ''} · version ${board.workflow.version}`}
        actions={
          <LinkButton href={`${base}/workflows/${board.workflow.id}`} variant="secondary">
            Workflow
          </LinkButton>
        }
      />
      <Board board={board} base={base} consultants={consultants ? consultants.map((c) => ({ id: c.id, name: c.fullName })) : null} />
    </>
  );
}
