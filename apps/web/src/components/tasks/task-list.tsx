'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { TASK_PRIORITY_LABEL, type TaskPriority, type TaskView } from '@crm/shared';
import { callApi } from '../forms';
import { Pill, cx, type Tone } from '../ui';
import { IconAlert, IconCheck } from '../icons';

const PRIORITY_TONE: Record<TaskPriority, Tone> = {
  urgent: 'bad',
  high: 'warn',
  normal: 'neutral',
  low: 'neutral',
};

/** "Today 3:00 pm", "Tomorrow", "Thu 2 Oct", "3 days overdue". */
export function dueLabel(iso: string | null, overdue: boolean): string {
  if (!iso) return 'No due date';
  const d = new Date(iso);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(d) - startOfDay(new Date())) / 86_400_000);
  const time = d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (overdue && days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue`;
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * A task list that is worked, not just read: the checkbox completes a task in
 * one click, optimistically, and puts it back if the server refuses.
 */
export function TaskList({
  tasks,
  hrefBase,
  showAssignee = false,
  showClient = true,
  empty = 'Nothing here.',
}: {
  tasks: TaskView[];
  /** '/desk' or '/overview' - where client and case links point. */
  hrefBase: string;
  showAssignee?: boolean;
  showClient?: boolean;
  empty?: string;
}) {
  const router = useRouter();
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  async function toggle(t: TaskView) {
    const next = !(done[t.id] ?? t.status === 'done');
    setDone((d) => ({ ...d, [t.id]: next }));
    setError(null);
    const res = await callApi(`/api/tasks/${t.id}`, {
      method: 'PATCH',
      json: { status: next ? 'done' : 'open' },
    });
    if (!res.ok) {
      setDone((d) => ({ ...d, [t.id]: !next }));
      setError(res.message ?? 'Could not update that task.');
      return;
    }
    router.refresh();
  }

  async function escalate(t: TaskView) {
    const res = await callApi(`/api/tasks/${t.id}`, { method: 'PATCH', json: { escalated: !t.escalated } });
    if (!res.ok) setError(res.message ?? 'Could not update that task.');
    else router.refresh();
  }

  if (tasks.length === 0) {
    return <p className="px-4 py-6 text-center text-[13px] text-ink-400 sm:px-5">{empty}</p>;
  }

  return (
    <div>
      {error && <p className="px-4 pb-2 text-[12.5px] text-bad-700 sm:px-5">{error}</p>}
      <ul className="divide-y divide-line">
        {tasks.map((t) => {
          const isDone = done[t.id] ?? t.status === 'done';
          return (
            <li key={t.id} className="group flex items-start gap-3 px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={() => toggle(t)}
                aria-pressed={isDone}
                aria-label={isDone ? `Reopen: ${t.title}` : `Mark done: ${t.title}`}
                className={cx(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                  isDone
                    ? 'border-ok-500 bg-ok-500 text-white'
                    : 'border-line-strong bg-paper text-transparent hover:border-ok-500',
                )}
              >
                <IconCheck size={13} />
              </button>

              <div className="min-w-0 flex-1">
                <p
                  className={cx(
                    'text-[14px] leading-5',
                    isDone ? 'text-ink-400 line-through' : 'font-medium text-ink-900',
                  )}
                >
                  {t.title}
                </p>
                {t.notes && !isDone && (
                  <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-500">{t.notes}</p>
                )}
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-400">
                  <span className={cx(!isDone && t.overdue && 'font-medium text-bad-700')}>
                    {isDone && t.completedAt
                      ? `Done ${new Date(t.completedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                      : dueLabel(t.dueAt, t.overdue)}
                  </span>
                  {showClient && t.clientName && t.clientId && (
                    <>
                      <span aria-hidden>&middot;</span>
                      <Link
                        href={t.caseId ? `${hrefBase}/cases/${t.caseId}` : `${hrefBase}/clients/${t.clientId}`}
                        className="text-ink-600 hover:text-brand-700 hover:underline"
                      >
                        {t.clientName}
                        {t.caseReference ? ` · ${t.caseReference}` : ''}
                      </Link>
                    </>
                  )}
                  {showAssignee && (
                    <>
                      <span aria-hidden>&middot;</span>
                      <span>{t.assigneeName}</span>
                    </>
                  )}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {t.escalated && !isDone && (
                  <Pill tone="bad" dot>
                    Escalated
                  </Pill>
                )}
                {t.priority !== 'normal' && !isDone && (
                  <Pill tone={PRIORITY_TONE[t.priority]}>{TASK_PRIORITY_LABEL[t.priority]}</Pill>
                )}
                {!isDone && (
                  <button
                    type="button"
                    onClick={() => escalate(t)}
                    title={t.escalated ? 'Remove escalation' : 'Escalate to a manager'}
                    className="hidden size-7 items-center justify-center rounded-md text-ink-300 hover:bg-ink-50 hover:text-bad-600 group-hover:flex"
                  >
                    <IconAlert size={15} />
                    <span className="sr-only">{t.escalated ? 'Remove escalation' : 'Escalate'}</span>
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
