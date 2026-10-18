'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  AUTOMATION_ACTIONS,
  AUTOMATION_ACTION_LABEL,
  AUTOMATION_STATUSES,
  AUTOMATION_TRIGGERS,
  AUTOMATION_TRIGGER_LABEL,
  CASE_STATUS_LABEL,
  CONDITION_FIELDS,
  MESSAGE_AUDIENCES,
  MESSAGE_AUDIENCE_LABEL,
  type AutomationAction,
  type AutomationActionType,
  type AutomationRuleView,
  type AutomationTrigger,
  type Condition,
} from '@crm/shared';
import { Button, Card, cx } from '../ui';
import { callApi, FormAlert } from '../forms';
import { IconClose, IconPlus } from '../icons';
import { AREA, ConditionsEditor, INPUT, MessageFields, NEW_MESSAGE, NEW_TASK, TaskFields, TokenHelp } from './editors';

export interface WorkflowStagesOption {
  id: string;
  name: string;
  stages: { key: string; name: string }[];
}

const STAGE_TRIGGERS: AutomationTrigger[] = ['stage_entered', 'stage_left', 'case_stuck'];
const DOCUMENT_TRIGGERS: AutomationTrigger[] = ['document_uploaded', 'document_approved', 'document_rejected'];

function blank(type: AutomationActionType): AutomationAction {
  switch (type) {
    case 'create_task':
      return { type, task: { ...NEW_TASK } };
    case 'notify':
      return { type, audience: 'consultant', title: '', body: '' };
    case 'send_message':
      return { type, message: { ...NEW_MESSAGE } };
    case 'move_stage':
      return { type, stageKey: '' };
    case 'set_status':
      return { type, status: 'on_hold' };
  }
}

/**
 * "When this happens to an application, if these hold, do these things."
 * Every firing is written to the run log with what each action did.
 */
export function AutomationEditor({
  base,
  initial,
  workflows,
  documentTypes,
}: {
  base: string;
  initial: AutomationRuleView | null;
  workflows: WorkflowStagesOption[];
  documentTypes: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [trigger, setTrigger] = useState<AutomationTrigger>(initial?.trigger ?? 'stage_entered');
  const [workflowId, setWorkflowId] = useState(initial?.workflowId ?? '');
  const [stageKey, setStageKey] = useState(initial?.stageKey ?? '');
  const [documentType, setDocumentType] = useState(initial?.documentType ?? '');
  const [conditions, setConditions] = useState<Condition[]>(initial?.conditions ?? []);
  const [actions, setActions] = useState<AutomationAction[]>(initial?.actions ?? [blank('create_task')]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const workflow = workflows.find((w) => w.id === workflowId);
  // Without a chosen workflow, offer every stage any workflow has, by key.
  const stageOptions = workflow
    ? workflow.stages
    : [...new Map(workflows.flatMap((w) => w.stages.map((s) => [s.key, { key: s.key, name: `${s.name} (${s.key})` }]))).values()];

  async function save() {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const json = {
      name: name.trim(),
      enabled,
      trigger,
      workflowId: workflowId || null,
      stageKey: STAGE_TRIGGERS.includes(trigger) ? stageKey || null : null,
      documentType: DOCUMENT_TRIGGERS.includes(trigger) ? documentType || null : null,
      conditions,
      actions,
    };
    const res = initial
      ? await callApi(`/api/automations/${initial.id}`, { method: 'PUT', json })
      : await callApi('/api/automations', { method: 'POST', json });
    setBusy(false);
    if (!res.ok) {
      setFieldErrors(res.fieldErrors);
      setError(res.message ?? Object.entries(res.fieldErrors).map(([k, v]) => `${k.replace(/^actions\.(\d+)/, (_, n) => `Action ${Number(n) + 1}`)}: ${v}`).join(' '));
      return;
    }
    router.push(`${base}/workflows/automations`);
    router.refresh();
  }

  async function remove() {
    if (!initial || !window.confirm('Remove this automation? Its run log stays.')) return;
    setBusy(true);
    const res = await callApi(`/api/automations/${initial.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) setError(res.message ?? 'Could not remove it.');
    else {
      router.push(`${base}/workflows/automations`);
      router.refresh();
    }
  }

  return (
    <div className="max-w-4xl space-y-4">
      {error && <FormAlert>{error}</FormAlert>}

      <Card className="space-y-4 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <label className="block text-[13px] font-medium text-ink-700">
            Name
            <input className={cx(INPUT, 'mt-1')} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chase missing documents" />
            {fieldErrors.name && <span className="mt-1 block text-[12px] font-normal text-bad-700">{fieldErrors.name}</span>}
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-[13px] text-ink-700">
            <input type="checkbox" className="size-4 accent-brand-700" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Switched on
          </label>
        </div>
      </Card>

      <Card className="space-y-3 p-4 sm:p-5">
        <h2 className="text-[15px] font-medium text-ink-950">When</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <select aria-label="Trigger" className={INPUT} value={trigger} onChange={(e) => setTrigger(e.target.value as AutomationTrigger)}>
            {AUTOMATION_TRIGGERS.map((t) => (
              <option key={t} value={t}>
                {AUTOMATION_TRIGGER_LABEL[t]}
              </option>
            ))}
          </select>
          <select aria-label="Workflow" className={INPUT} value={workflowId} onChange={(e) => setWorkflowId(e.target.value)}>
            <option value="">On any workflow</option>
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>
                Only on {w.name}
              </option>
            ))}
          </select>
          {STAGE_TRIGGERS.includes(trigger) && (
            <select aria-label="Stage" className={INPUT} value={stageKey} onChange={(e) => setStageKey(e.target.value)}>
              <option value="">At any stage</option>
              {stageOptions.map((s) => (
                <option key={s.key} value={s.key}>
                  {trigger === 'stage_left' ? 'Leaving' : trigger === 'case_stuck' ? 'Stuck at' : 'Entering'} {s.name}
                </option>
              ))}
            </select>
          )}
          {DOCUMENT_TRIGGERS.includes(trigger) && (
            <select aria-label="Document type" className={INPUT} value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
              <option value="">Any document</option>
              {documentTypes.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          )}
        </div>
        {fieldErrors.stageKey && <p className="text-[12px] text-bad-700">{fieldErrors.stageKey}</p>}
      </Card>

      <Card className="space-y-3 p-4 sm:p-5">
        <h2 className="text-[15px] font-medium text-ink-950">Only if</h2>
        <ConditionsEditor value={conditions} onChange={setConditions} fields={CONDITION_FIELDS} empty="Every time it happens." />
      </Card>

      <Card className="space-y-3 p-4 sm:p-5">
        <h2 className="text-[15px] font-medium text-ink-950">Do this</h2>
        {actions.map((a, i) => (
          <div key={i} className="rounded-lg bg-ink-50 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="tnum text-[12px] font-medium text-ink-400">{i + 1}.</span>
              <select
                aria-label="Action"
                className={cx(INPUT, 'max-w-xs')}
                value={a.type}
                onChange={(e) => setActions(actions.map((x, j) => (j === i ? blank(e.target.value as AutomationActionType) : x)))}
              >
                {AUTOMATION_ACTIONS.map((t) => (
                  <option key={t} value={t}>
                    {AUTOMATION_ACTION_LABEL[t]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ml-auto rounded-md p-1.5 text-ink-400 hover:bg-bad-50 hover:text-bad-700"
                aria-label="Remove action"
                onClick={() => setActions(actions.filter((_, j) => j !== i))}
              >
                <IconClose size={15} />
              </button>
            </div>
            <ActionFields value={a} onChange={(v) => setActions(actions.map((x, j) => (j === i ? v : x)))} stages={stageOptions} />
          </div>
        ))}
        <Button size="sm" variant="ghost" className="-ml-2" onClick={() => setActions([...actions, blank('notify')])} disabled={actions.length >= 10}>
          <IconPlus size={15} />
          Add action
        </Button>
        <TokenHelp />
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button onClick={save} disabled={busy || name.trim().length < 2 || actions.length === 0}>
            {busy ? 'Saving…' : initial ? 'Save automation' : 'Create automation'}
          </Button>
          <Button variant="ghost" onClick={() => router.back()} disabled={busy}>
            Cancel
          </Button>
        </div>
        {initial && (
          <Button variant="ghost" onClick={remove} disabled={busy}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

function ActionFields({
  value,
  onChange,
  stages,
}: {
  value: AutomationAction;
  onChange: (v: AutomationAction) => void;
  stages: { key: string; name: string }[];
}) {
  switch (value.type) {
    case 'create_task':
      return <TaskFields value={value.task} onChange={(task) => onChange({ ...value, task })} />;
    case 'send_message':
      return <MessageFields value={value.message} onChange={(message) => onChange({ ...value, message })} />;
    case 'notify':
      return (
        <div className="space-y-2">
          <select aria-label="Who" className={cx(INPUT, 'w-56')} value={value.audience} onChange={(e) => onChange({ ...value, audience: e.target.value as typeof value.audience })}>
            {MESSAGE_AUDIENCES.map((a) => (
              <option key={a} value={a}>
                Tell {MESSAGE_AUDIENCE_LABEL[a].toLowerCase()}
              </option>
            ))}
          </select>
          <input aria-label="Title" className={INPUT} value={value.title} placeholder="e.g. {reference} needs a look" onChange={(e) => onChange({ ...value, title: e.target.value })} />
          <textarea aria-label="Details" className={AREA} rows={2} value={value.body} placeholder="Details (optional)" onChange={(e) => onChange({ ...value, body: e.target.value })} />
        </div>
      );
    case 'move_stage':
      return (
        <select aria-label="To stage" className={cx(INPUT, 'max-w-sm')} value={value.stageKey} onChange={(e) => onChange({ ...value, stageKey: e.target.value })}>
          <option value="">Choose a stage</option>
          {stages.map((s) => (
            <option key={s.key} value={s.key}>
              Move to {s.name}
            </option>
          ))}
        </select>
      );
    case 'set_status':
      return (
        <select aria-label="Status" className={cx(INPUT, 'max-w-xs')} value={value.status} onChange={(e) => onChange({ ...value, status: e.target.value as typeof value.status })}>
          {AUTOMATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CASE_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      );
  }
}
