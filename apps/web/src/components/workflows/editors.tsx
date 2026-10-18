'use client';

import {
  CONDITION_FIELD_LABEL,
  CONDITION_OPS,
  CONDITION_OP_LABEL,
  CURRENCIES,
  MESSAGE_AUDIENCES,
  MESSAGE_AUDIENCE_LABEL,
  MESSAGE_CHANNELS,
  MESSAGE_CHANNEL_LABEL,
  MESSAGE_TOKENS,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABEL,
  type Condition,
  type ConditionField,
  type ConditionOp,
  type StageFee,
  type StageMessage,
  type StageTask,
} from '@crm/shared';
import { Button, cx } from '../ui';
import { IconClose, IconPlus } from '../icons';

/*
 * The small list editors the workflow builder and the automation builder
 * share: conditions, tasks, fees and messages. Each is a controlled list -
 * the parent owns the array.
 */

export const INPUT = 'h-9 w-full min-w-0 rounded-lg border border-line-strong bg-paper px-2.5 text-[13.5px] text-ink-900 placeholder:text-ink-300 focus:border-brand-500 focus:outline-none';
export const AREA = 'w-full min-w-0 rounded-lg border border-line-strong bg-paper px-2.5 py-2 text-[13.5px] text-ink-900 placeholder:text-ink-300 focus:border-brand-500 focus:outline-none';

function update<T>(list: T[], i: number, patch: Partial<T>): T[] {
  return list.map((x, j) => (j === i ? { ...x, ...patch } : x));
}

function Remove({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="press shrink-0 rounded-md p-1.5 text-ink-400 hover:bg-bad-50 hover:text-bad-700" aria-label={label} title={label}>
      <IconClose size={15} />
    </button>
  );
}

function Add({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <Button type="button" size="sm" variant="ghost" onClick={onClick} className="-ml-2">
      <IconPlus size={15} />
      {children}
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* Conditions                                                          */
/* ------------------------------------------------------------------ */

const LIST_OPS: ConditionOp[] = ['in', 'not_in'];
const NO_VALUE: ConditionOp[] = ['is_set', 'is_empty'];
const NUMBER_OPS: ConditionOp[] = ['gte', 'lte'];

export function ConditionsEditor({
  value,
  onChange,
  fields,
  empty,
}: {
  value: Condition[];
  onChange: (v: Condition[]) => void;
  fields: readonly ConditionField[];
  empty: string;
}) {
  return (
    <div className="space-y-2">
      {value.length === 0 && <p className="text-[12.5px] text-ink-400">{empty}</p>}
      {value.map((c, i) => {
        const ops = CONDITION_OPS.filter((op) => (c.field === 'daysInStage' ? NUMBER_OPS.includes(op) || NO_VALUE.includes(op) : !NUMBER_OPS.includes(op)));
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            <select
              aria-label="Field"
              className={cx(INPUT, 'sm:w-44')}
              value={c.field}
              onChange={(e) => {
                const field = e.target.value as ConditionField;
                onChange(update(value, i, field === 'daysInStage' ? { field, op: 'gte', value: 7 } : { field, op: 'is', value: '' }));
              }}
            >
              {fields.map((f) => (
                <option key={f} value={f}>
                  {CONDITION_FIELD_LABEL[f]}
                </option>
              ))}
            </select>
            <select
              aria-label="Test"
              className={cx(INPUT, 'sm:w-36')}
              value={c.op}
              onChange={(e) => {
                const op = e.target.value as ConditionOp;
                const v = LIST_OPS.includes(op)
                  ? Array.isArray(c.value)
                    ? c.value
                    : typeof c.value === 'string' && c.value
                      ? [c.value]
                      : []
                  : NO_VALUE.includes(op)
                    ? undefined
                    : NUMBER_OPS.includes(op)
                      ? typeof c.value === 'number'
                        ? c.value
                        : 7
                      : Array.isArray(c.value)
                        ? (c.value[0] ?? '')
                        : typeof c.value === 'string'
                          ? c.value
                          : '';
                onChange(update(value, i, { op, value: v }));
              }}
            >
              {ops.map((op) => (
                <option key={op} value={op}>
                  {CONDITION_OP_LABEL[op]}
                </option>
              ))}
            </select>
            {!NO_VALUE.includes(c.op) &&
              (NUMBER_OPS.includes(c.op) ? (
                <input
                  aria-label="Value"
                  className={cx(INPUT, 'sm:w-24')}
                  type="number"
                  min={0}
                  value={typeof c.value === 'number' ? c.value : ''}
                  onChange={(e) => onChange(update(value, i, { value: Number(e.target.value) }))}
                />
              ) : (
                <input
                  aria-label="Value"
                  className={INPUT}
                  value={Array.isArray(c.value) ? c.value.join(', ') : typeof c.value === 'string' ? c.value : ''}
                  placeholder={LIST_OPS.includes(c.op) ? 'Separate with commas' : 'Value'}
                  onChange={(e) =>
                    onChange(
                      update(value, i, {
                        value: LIST_OPS.includes(c.op)
                          ? e.target.value
                              .split(',')
                              .map((x) => x.trimStart())
                              .filter((x, j, all) => x || j === all.length - 1)
                          : e.target.value,
                      }),
                    )
                  }
                  onBlur={() => {
                    if (Array.isArray(c.value)) onChange(update(value, i, { value: c.value.map((x) => x.trim()).filter(Boolean) }));
                  }}
                />
              ))}
            <Remove onClick={() => onChange(value.filter((_, j) => j !== i))} label="Remove condition" />
          </div>
        );
      })}
      <Add onClick={() => onChange([...value, { field: fields[0]!, op: 'is', value: '' }])}>Add condition</Add>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

export function TaskFields({ value, onChange }: { value: StageTask; onChange: (v: StageTask) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_150px_120px]">
      <input aria-label="Task" className={INPUT} value={value.title} placeholder="e.g. Book the biometrics appointment for {student}" onChange={(e) => onChange({ ...value, title: e.target.value })} />
      <label className="flex items-center gap-1.5 text-[12.5px] text-ink-500">
        Due in
        <input aria-label="Due in days" className={cx(INPUT, 'w-16')} type="number" min={0} max={365} value={value.dueInDays} onChange={(e) => onChange({ ...value, dueInDays: Number(e.target.value) })} />
        d
      </label>
      <select aria-label="Who" className={INPUT} value={value.assignee} onChange={(e) => onChange({ ...value, assignee: e.target.value as StageTask['assignee'] })}>
        <option value="consultant">Their consultant</option>
        <option value="managers">A manager</option>
      </select>
      <select aria-label="Priority" className={INPUT} value={value.priority} onChange={(e) => onChange({ ...value, priority: e.target.value as StageTask['priority'] })}>
        {TASK_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {TASK_PRIORITY_LABEL[p]}
          </option>
        ))}
      </select>
    </div>
  );
}

export const NEW_TASK: StageTask = { title: '', dueInDays: 2, assignee: 'consultant', priority: 'normal' };

export function TasksEditor({ value, onChange }: { value: StageTask[]; onChange: (v: StageTask[]) => void }) {
  return (
    <div className="space-y-2">
      {value.length === 0 && <p className="text-[12.5px] text-ink-400">No tasks are created.</p>}
      {value.map((t, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <TaskFields value={t} onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)))} />
          </div>
          <Remove onClick={() => onChange(value.filter((_, j) => j !== i))} label="Remove task" />
        </div>
      ))}
      <Add onClick={() => onChange([...value, { ...NEW_TASK }])}>Add task</Add>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fees                                                                */
/* ------------------------------------------------------------------ */

export function FeesEditor({ value, onChange }: { value: StageFee[]; onChange: (v: StageFee[]) => void }) {
  return (
    <div className="space-y-2">
      {value.length === 0 && <p className="text-[12.5px] text-ink-400">No fee at this stage.</p>}
      {value.map((f, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_130px_90px_170px_110px]">
            <input aria-label="Fee" className={INPUT} value={f.label} placeholder="e.g. Visa filing service fee" onChange={(e) => onChange(update(value, i, { label: e.target.value }))} />
            <input
              aria-label="Amount"
              className={INPUT}
              inputMode="decimal"
              value={f.amount ? String(f.amount / 100) : ''}
              placeholder="Amount"
              onChange={(e) => onChange(update(value, i, { amount: Math.round(Number(e.target.value.replace(/,/g, '')) * 100) || 0 }))}
            />
            <select aria-label="Currency" className={INPUT} value={f.currency} onChange={(e) => onChange(update(value, i, { currency: e.target.value as StageFee['currency'] }))}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select aria-label="How" className={INPUT} value={f.mode} onChange={(e) => onChange(update(value, i, { mode: e.target.value as StageFee['mode'] }))}>
              <option value="task">Task to collect it</option>
              <option value="invoice">Issue an invoice</option>
            </select>
            <label className="flex items-center gap-1.5 text-[12.5px] text-ink-500">
              Due in
              <input aria-label="Due in days" className={cx(INPUT, 'w-16')} type="number" min={0} max={180} value={f.dueInDays} onChange={(e) => onChange(update(value, i, { dueInDays: Number(e.target.value) }))} />
              d
            </label>
          </div>
          <Remove onClick={() => onChange(value.filter((_, j) => j !== i))} label="Remove fee" />
        </div>
      ))}
      <Add onClick={() => onChange([...value, { label: '', amount: 0, currency: 'PKR', mode: 'task', dueInDays: 7 }])}>Add fee</Add>
      {value.some((f) => f.mode === 'invoice') && (
        <p className="text-[12px] text-ink-400">
          An invoice is issued when a member of staff with invoicing rights moves the application here and your plan has billing; otherwise it becomes a task to collect it.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export const NEW_MESSAGE: StageMessage = { audience: 'student', channels: ['in_app', 'email'], subject: '', body: '' };

export function MessageFields({ value, onChange }: { value: StageMessage; onChange: (v: StageMessage) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="To" className={cx(INPUT, 'w-44')} value={value.audience} onChange={(e) => onChange({ ...value, audience: e.target.value as StageMessage['audience'] })}>
          {MESSAGE_AUDIENCES.map((a) => (
            <option key={a} value={a}>
              To {MESSAGE_AUDIENCE_LABEL[a].toLowerCase()}
            </option>
          ))}
        </select>
        {MESSAGE_CHANNELS.map((ch) => (
          <label key={ch} className="flex items-center gap-1.5 text-[13px] text-ink-700">
            <input
              type="checkbox"
              className="size-4 accent-brand-700"
              checked={value.channels.includes(ch)}
              onChange={(e) => onChange({ ...value, channels: e.target.checked ? [...value.channels, ch] : value.channels.filter((c) => c !== ch) })}
            />
            {MESSAGE_CHANNEL_LABEL[ch]}
          </label>
        ))}
      </div>
      <input aria-label="Subject" className={INPUT} value={value.subject} placeholder="Subject, e.g. Your {country} checklist, {first_name}" onChange={(e) => onChange({ ...value, subject: e.target.value })} />
      <textarea aria-label="Message" className={AREA} rows={3} value={value.body} placeholder="The message. Placeholders are filled in when it is sent." onChange={(e) => onChange({ ...value, body: e.target.value })} />
    </div>
  );
}

export function MessagesEditor({ value, onChange }: { value: StageMessage[]; onChange: (v: StageMessage[]) => void }) {
  return (
    <div className="space-y-3">
      {value.length === 0 && <p className="text-[12.5px] text-ink-400">No messages are sent.</p>}
      {value.map((m, i) => (
        <div key={i} className="flex items-start gap-2 rounded-lg bg-ink-50 p-2.5">
          <div className="min-w-0 flex-1">
            <MessageFields value={m} onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)))} />
          </div>
          <Remove onClick={() => onChange(value.filter((_, j) => j !== i))} label="Remove message" />
        </div>
      ))}
      <Add onClick={() => onChange([...value, { ...NEW_MESSAGE }])}>Add message</Add>
      <TokenHelp />
    </div>
  );
}

export function TokenHelp() {
  return (
    <details className="text-[12px] text-ink-500">
      <summary className="cursor-pointer select-none font-medium text-ink-600">Placeholders you can use</summary>
      <ul className="mt-1.5 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
        {MESSAGE_TOKENS.map((t) => (
          <li key={t.token}>
            <code className="rounded bg-ink-100 px-1 font-mono text-[11.5px] text-ink-800">{t.token}</code> {t.label}
          </li>
        ))}
      </ul>
      <p className="mt-1.5">SMS and WhatsApp go out once the consultancy’s messaging provider is connected; until then they are logged, and the run log says so.</p>
    </details>
  );
}
