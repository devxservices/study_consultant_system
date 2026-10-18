import Link from 'next/link';
import type { Paginated, TaskCounts, TaskView } from '@crm/shared';
import { apiFetch, qs } from '@/lib/api';
import { Card, PageHeader, StatCard, cx } from '../ui';
import { IconAlert, IconClock, IconMegaphone, IconTasks } from '../icons';
import { Pagination } from '../client-table';
import { TaskComposer } from './task-composer';
import { TaskList } from './task-list';

const VIEWS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'open', label: 'All open' },
  { key: 'done', label: 'Done' },
] as const;

/**
 * The follow-up list, for a consultant (their own) or a manager (everyone's,
 * filterable by person). Overdue first, because that is the tab that costs
 * the consultancy a student when it is ignored.
 */
export async function TasksPage({
  base,
  searchParams,
  manager,
}: {
  base: '/desk' | '/overview';
  searchParams: Record<string, string | undefined>;
  manager: boolean;
}) {
  const view = VIEWS.some((v) => v.key === searchParams.view) ? searchParams.view! : 'overdue';
  const assignee = manager ? searchParams.assignee : undefined;
  const escalated = searchParams.escalated === 'true';
  const page = Number(searchParams.page) || 1;

  const [counts, data, assignees] = await Promise.all([
    apiFetch<TaskCounts>(`/tasks/counts${manager && assignee !== 'me' ? '?scope=all' : ''}`),
    apiFetch<Paginated<TaskView>>(
      `/tasks${qs({ view, assignee, escalated: escalated || undefined, page, pageSize: 30 })}`,
    ),
    manager ? apiFetch<{ id: string; name: string }[]>('/tasks/assignees') : Promise.resolve(undefined),
  ]);

  const href = (p: Record<string, string | number | undefined>) =>
    `${base}/tasks${qs({ view, assignee, escalated: escalated ? 'true' : undefined, ...p })}`;

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle={
          manager
            ? 'Every follow-up across the consultancy, and who owns it.'
            : 'Your follow-ups. Tick them off as you go.'
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Overdue" value={counts.overdue} tone={counts.overdue ? 'bad' : 'neutral'} icon={<IconAlert size={18} />} href={href({ view: 'overdue', page: undefined })} hint="past their due time" />
        <StatCard label="Due today" value={counts.today} tone={counts.today ? 'warn' : 'neutral'} icon={<IconClock size={18} />} href={href({ view: 'today', page: undefined })} hint="before the office closes" />
        <StatCard label="Open" value={counts.open} icon={<IconTasks size={18} />} href={href({ view: 'open', page: undefined })} hint="everything not yet done" />
        <StatCard label="Escalated" value={counts.escalated} tone={counts.escalated ? 'bad' : 'neutral'} icon={<IconMegaphone size={18} />} href={`${base}/tasks?view=open&escalated=true`} hint="flagged for a manager" />
      </div>

      <Card className="mt-5 p-4 sm:p-5">
        <TaskComposer assignees={assignees} />
      </Card>

      <Card className="mt-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 pt-3 sm:px-5">
          <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Task views">
            {VIEWS.map((v) => (
              <Link
                key={v.key}
                href={href({ view: v.key, page: undefined })}
                aria-current={view === v.key ? 'page' : undefined}
                className={cx(
                  'whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-[13.5px] font-medium transition-colors',
                  view === v.key
                    ? 'border-brand-600 text-ink-950'
                    : 'border-transparent text-ink-500 hover:text-ink-800',
                )}
              >
                {v.label}
                {v.key === 'overdue' && counts.overdue > 0 && (
                  <span className="tnum ml-1.5 rounded-full bg-bad-50 px-1.5 text-[11px] text-bad-700">{counts.overdue}</span>
                )}
                {v.key === 'today' && counts.today > 0 && (
                  <span className="tnum ml-1.5 rounded-full bg-warn-50 px-1.5 text-[11px] text-warn-700">{counts.today}</span>
                )}
              </Link>
            ))}
          </nav>

          {manager && assignees && (
            <form className="pb-2.5" action={`${base}/tasks`}>
              <input type="hidden" name="view" value={view} />
              <label className="sr-only" htmlFor="assignee">Assigned to</label>
              <select
                id="assignee"
                name="assignee"
                defaultValue={assignee ?? ''}
                className="h-8 rounded-md border border-line-strong bg-paper px-2 text-[13px] text-ink-700"
              >
                <option value="">Everyone</option>
                <option value="me">Me</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="ml-2 h-8 rounded-md border border-line-strong px-3 text-[13px] text-ink-700 hover:bg-ink-50">
                Filter
              </button>
            </form>
          )}
        </div>

        <TaskList
          tasks={data.items}
          hrefBase={base}
          showAssignee={manager}
          empty={
            view === 'overdue'
              ? 'Nothing overdue. Well done.'
              : view === 'today'
                ? 'Nothing due today.'
                : view === 'done'
                  ? 'Nothing finished yet.'
                  : 'No tasks here.'
          }
        />
      </Card>
      <Pagination data={data} buildHref={(p) => href({ page: p })} />
    </>
  );
}
