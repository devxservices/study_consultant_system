'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL } from '@crm/shared';
import { callApi, SelectInput, TextInput } from '../forms';
import { Button, cx } from '../ui';

/** Local "YYYY-MM-DDTHH:mm" for a datetime-local input. */
function localInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const QUICK = [
  { label: 'Today 5pm', at: () => { const d = new Date(); d.setHours(17, 0, 0, 0); return d; } },
  { label: 'Tomorrow 10am', at: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d; } },
  { label: 'In a week', at: () => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(10, 0, 0, 0); return d; } },
];

/**
 * Adding a follow-up takes one line and one click: a title and, usually, one
 * of the quick due times. Linked to a client or case when it is opened from
 * their page.
 */
export function TaskComposer({
  clientId,
  caseId,
  assignees,
  compact = false,
}: {
  clientId?: string;
  caseId?: string;
  /** Shown to managers so they can hand the task to someone. */
  assignees?: { id: string; name: string }[];
  compact?: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('normal');
  const [assigneeId, setAssigneeId] = useState('');
  const [more, setMore] = useState(!compact);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await callApi('/api/tasks', {
      method: 'POST',
      json: {
        title: title.trim(),
        clientId,
        caseId,
        priority,
        ...(due ? { dueAt: new Date(due).toISOString() } : {}),
        ...(assigneeId ? { assigneeId } : {}),
      },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.fieldErrors.title ?? res.message ?? Object.values(res.fieldErrors)[0] ?? null);
      return;
    }
    setTitle('');
    setDue('');
    setPriority('normal');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-2.5">
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <TextInput
            value={title}
            onChange={setTitle}
            placeholder="Add a follow-up, e.g. “Call about the bank statement”"
            invalid={Boolean(error)}
          />
        </div>
        <Button type="submit" disabled={busy || title.trim().length < 3}>
          {busy ? 'Adding…' : 'Add'}
        </Button>
      </div>

      {compact && !more ? (
        <button
          type="button"
          onClick={() => setMore(true)}
          className="text-[12.5px] font-medium text-brand-700 hover:underline"
        >
          Set a due time or priority
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {QUICK.map((q) => {
            const v = localInput(q.at());
            return (
              <button
                key={q.label}
                type="button"
                onClick={() => setDue(v)}
                className={cx(
                  'h-8 rounded-full border px-3 text-[12.5px] transition-colors',
                  due === v
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-line-strong bg-paper text-ink-600 hover:bg-ink-50',
                )}
              >
                {q.label}
              </button>
            );
          })}
          <input
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label="Due"
            className="h-8 rounded-md border border-line-strong bg-paper px-2 text-[12.5px] text-ink-700"
          />
          <div className="w-40">
            <SelectInput
              value={priority}
              onChange={setPriority}
              options={TASK_PRIORITIES.map((p) => ({ value: p, label: `${TASK_PRIORITY_LABEL[p]} priority` }))}
            />
          </div>
          {assignees && assignees.length > 0 && (
            <div className="w-48">
              <SelectInput
                value={assigneeId}
                onChange={setAssigneeId}
                placeholder="Assign to me"
                options={assignees.map((a) => ({ value: a.id, label: a.name }))}
              />
            </div>
          )}
        </div>
      )}
      {error && <p className="text-[12px] text-bad-700">{error}</p>}
    </form>
  );
}
