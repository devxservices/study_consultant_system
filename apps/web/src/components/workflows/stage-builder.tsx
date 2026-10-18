'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  STAGES,
  STAGE_CONDITION_FIELDS,
  STAGE_DEFINITIONS,
  WORKFLOW_COLORS,
  describeCondition,
  saveWorkflowDraftSchema,
  type Stage,
  type WorkflowColor,
  type WorkflowStage,
  type WorkflowStageView,
} from '@crm/shared';
import { Button, Pill, cx } from '../ui';
import { callApi, FormAlert } from '../forms';
import { Modal } from '../modal';
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '../icons';
import { AREA, ConditionsEditor, FeesEditor, INPUT, MessagesEditor, TasksEditor } from './editors';

export const STAGE_COLOR_DOT: Record<WorkflowColor, string> = {
  slate: 'bg-ink-400',
  blue: 'bg-info-500',
  violet: 'bg-[#8b5cf6]',
  teal: 'bg-[#14b8a6]',
  green: 'bg-ok-500',
  amber: 'bg-warn-500',
  orange: 'bg-[#f97316]',
  rose: 'bg-bad-500',
};

/** A stage being edited. `isNew`: added in this session, so its key follows its name. */
type Draft = WorkflowStage & { uid: string; isNew?: boolean };

let seq = 0;
const uid = () => `s${++seq}`;

function toDraft(s: WorkflowStageView | WorkflowStage): Draft {
  const { ...rest } = s as WorkflowStage & { id?: string; position?: number };
  delete (rest as { id?: string }).id;
  delete (rest as { position?: number }).position;
  return { ...(rest as WorkflowStage), uid: uid() };
}

function slug(name: string, taken: Set<string>): string {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36);
  if (!/^[a-z]/.test(base)) base = `stage_${base}`.slice(0, 36);
  if (base.length < 2) base = 'stage';
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  return key;
}

/**
 * The stage builder: the draft of a workflow, edited as a list. Stages are
 * reordered by dragging (or the arrow buttons, from the keyboard), and each
 * one is configured on the right - what it is called for staff and for the
 * student, which of the ten steps it counts as, its time limit and
 * documents, who may move it, when it applies, and what happens when an
 * application arrives. Saving keeps a draft; publishing makes it the
 * version new applications start on.
 */
export function StageBuilder({
  workflowId,
  initial,
  hasDraft,
  hasPublished,
  draftNotes,
  documentTypes,
  canEdit,
  openOnOlderVersions,
}: {
  workflowId: string;
  initial: WorkflowStageView[];
  hasDraft: boolean;
  hasPublished: boolean;
  draftNotes: string | null;
  documentTypes: { key: string; label: string }[];
  canEdit: boolean;
  /** Open applications that would move if published with "move them". */
  openOnOlderVersions: number;
}) {
  const router = useRouter();
  const [stages, setStages] = useState<Draft[]>(() => initial.map(toDraft));
  const [selected, setSelected] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [notes, setNotes] = useState(draftNotes ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [publishing, setPublishing] = useState(false);
  const [upgrade, setUpgrade] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);

  const current = stages[selected];
  const labels = useMemo(() => new Map(documentTypes.map((d) => [d.key, d.label])), [documentTypes]);

  function change(next: Draft[]) {
    setStages(next);
    setDirty(true);
    setMessage(null);
  }
  function patch(p: Partial<WorkflowStage>) {
    change(stages.map((s, i) => (i === selected ? { ...s, ...p } : s)));
  }
  function move(from: number, to: number) {
    if (to < 0 || to >= stages.length || from === to) return;
    const next = [...stages];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    change(next);
    setSelected(to);
  }
  function add() {
    const after = stages[selected];
    const taken = new Set(stages.map((s) => s.key));
    const fresh: Draft = {
      uid: uid(),
      isNew: true,
      key: slug('new stage', taken),
      name: 'New stage',
      clientLabel: 'New stage',
      clientDescription: '',
      category: (after?.category === 'closed' ? 'visa_decision' : after?.category) ?? 'inquiry',
      color: 'blue',
      slaDays: 14,
      requiredDocuments: [],
      autoAdvance: true,
      approvalRequired: false,
      movableBy: 'staff',
      conditions: [],
      tasks: [],
      fees: [],
      messages: [],
      notifyStudent: true,
    };
    const at = after?.category === 'closed' ? selected : selected + 1;
    const next = [...stages];
    next.splice(at, 0, fresh);
    change(next);
    setSelected(at);
  }
  function remove(i: number) {
    if (stages.length <= 2) return;
    change(stages.filter((_, j) => j !== i));
    setSelected(Math.max(0, Math.min(i, stages.length - 2)));
  }

  /** Client-side first: the same schema the server uses, so most mistakes show at once. */
  function validate(): boolean {
    const result = saveWorkflowDraftSchema.safeParse({ stages: stages.map(({ uid: _u, isNew: _n, ...s }) => s), notes });
    if (result.success) {
      setIssues({});
      return true;
    }
    const found: Record<string, string> = {};
    for (const issue of result.error.issues) found[issue.path.join('.')] ??= issue.message;
    setIssues(found);
    setMessage({ tone: 'bad', text: describeIssues(found, stages) });
    const first = Object.keys(found).map((k) => Number(k.split('.')[1])).find((n) => Number.isFinite(n));
    if (first !== undefined) setSelected(first);
    return false;
  }

  async function save(): Promise<boolean> {
    if (!validate()) return false;
    setBusy(true);
    const res = await callApi(`/api/workflows/${workflowId}/draft`, {
      method: 'PUT',
      json: { stages: stages.map(({ uid: _u, isNew: _n, ...s }) => s), notes: notes || undefined },
    });
    setBusy(false);
    if (!res.ok) {
      setIssues(res.fieldErrors);
      setMessage({ tone: 'bad', text: Object.keys(res.fieldErrors).length ? describeIssues(res.fieldErrors, stages) : (res.message ?? 'Could not save.') });
      return false;
    }
    setDirty(false);
    setIssues({});
    setMessage({ tone: 'ok', text: 'Draft saved. Applications keep using the published version until you publish.' });
    router.refresh();
    return true;
  }

  async function publish() {
    if (dirty && !(await save())) {
      setPublishing(false);
      return;
    }
    setBusy(true);
    const res = await callApi<{ upgraded: number; current: { version: number } }>(`/api/workflows/${workflowId}/publish`, {
      method: 'POST',
      json: { notes: notes || undefined, upgradeActive: upgrade },
    });
    setBusy(false);
    setPublishing(false);
    if (!res.ok) {
      setMessage({ tone: 'bad', text: res.message ?? 'Could not publish.' });
      return;
    }
    setMessage({
      tone: 'ok',
      text: `Published as version ${res.data?.current.version}.${res.data?.upgraded ? ` ${res.data.upgraded} open application${res.data.upgraded === 1 ? '' : 's'} moved to it.` : ''}`,
    });
    setDirty(false);
    router.refresh();
  }

  async function discard() {
    if (!window.confirm('Throw away the unpublished changes? The published version stays as it is.')) return;
    setBusy(true);
    const res = await callApi(`/api/workflows/${workflowId}/draft`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) setMessage({ tone: 'bad', text: res.message ?? 'Could not discard.' });
    else {
      setDirty(false);
      router.refresh();
      window.location.reload();
    }
  }

  const issueFor = (i: number) => Object.keys(issues).some((k) => k.startsWith(`stages.${i}.`) || k === `stages.${i}`);

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-paper px-4 py-3 shadow-card">
          <p className="text-[13px] text-ink-500">
            {dirty ? (
              <span className="font-medium text-warn-700">Unsaved changes</span>
            ) : hasDraft ? (
              'Editing a draft. Applications use the published version until you publish.'
            ) : hasPublished ? (
              'Showing the published version. Any change becomes a draft.'
            ) : (
              'Not published yet: no application can use this workflow until you publish it.'
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {hasDraft && hasPublished && (
              <Button size="sm" variant="ghost" onClick={discard} disabled={busy}>
                Discard draft
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => void save()} disabled={busy || !dirty}>
              {busy ? 'Saving…' : 'Save draft'}
            </Button>
            <Button size="sm" onClick={() => validate() && setPublishing(true)} disabled={busy || (!dirty && !hasDraft)}>
              Publish…
            </Button>
          </div>
        </div>
      )}

      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}

      <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <ol className="space-y-1.5" aria-label="Stages, in order">
          {stages.map((s, i) => (
            <li
              key={s.uid}
              draggable={canEdit}
              onDragStart={() => setDragging(i)}
              onDragOver={(e) => {
                if (dragging === null) return;
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging !== null) move(dragging, i);
                setDragging(null);
              }}
              onDragEnd={() => setDragging(null)}
              className={cx(
                'group flex items-center gap-2 rounded-lg px-2.5 py-2 ring-1 transition-colors',
                i === selected ? 'bg-brand-50 ring-brand-400' : 'bg-paper ring-line hover:bg-ink-50',
                issueFor(i) && 'ring-bad-500',
                dragging === i && 'opacity-50',
                canEdit && 'cursor-grab active:cursor-grabbing',
              )}
            >
              <span className="tnum w-5 shrink-0 text-right text-[12px] text-ink-400">{i + 1}</span>
              <span className={cx('size-2.5 shrink-0 rounded-full', STAGE_COLOR_DOT[s.color])} aria-hidden />
              <button type="button" onClick={() => setSelected(i)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[13.5px] font-medium text-ink-900">{s.name || 'Untitled stage'}</span>
                <span className="block truncate text-[11.5px] text-ink-500">
                  {STAGE_DEFINITIONS[s.category].label}
                  {s.requiredDocuments.length > 0 && ` · ${s.requiredDocuments.length} doc${s.requiredDocuments.length === 1 ? '' : 's'}`}
                  {s.conditions.length > 0 && ' · conditional'}
                </span>
              </button>
              <span className="flex shrink-0 items-center gap-1">
                {s.approvalRequired && <Pill tone="warn">Sign-off</Pill>}
                {s.movableBy === 'managers' && <Pill tone="neutral">Managers</Pill>}
              </span>
              {canEdit && (
                <span className="flex shrink-0 flex-col opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button type="button" aria-label={`Move ${s.name} up`} onClick={() => move(i, i - 1)} disabled={i === 0} className="rounded p-0.5 text-ink-400 hover:text-ink-900 disabled:opacity-30">
                    <IconArrowUp size={13} />
                  </button>
                  <button type="button" aria-label={`Move ${s.name} down`} onClick={() => move(i, i + 1)} disabled={i === stages.length - 1} className="rounded p-0.5 text-ink-400 hover:text-ink-900 disabled:opacity-30">
                    <IconArrowDown size={13} />
                  </button>
                </span>
              )}
            </li>
          ))}
          {canEdit && (
            <li>
              <Button size="sm" variant="ghost" onClick={add} className="w-full justify-center">
                <IconPlus size={15} />
                Add a stage after “{current?.name ?? 'the last one'}”
              </Button>
            </li>
          )}
        </ol>

        {current && (
          <fieldset disabled={!canEdit} className="min-w-0 space-y-4 rounded-xl bg-paper p-4 shadow-card sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-medium uppercase tracking-wide text-ink-400">Stage {selected + 1}</p>
                <h3 className="text-[16px] font-semibold text-ink-950">{current.name || 'Untitled stage'}</h3>
              </div>
              {canEdit && stages.length > 2 && (
                <Button size="sm" variant="ghost" onClick={() => remove(selected)}>
                  <IconTrash size={15} />
                  Remove
                </Button>
              )}
            </div>

            <Section title="What it is">
              <div className="grid gap-3 sm:grid-cols-2">
                <Labelled label="Name, for staff" error={issues[`stages.${selected}.name`]}>
                  <input
                    className={INPUT}
                    value={current.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      patch({
                        name,
                        ...(current.isNew ? { key: slug(name || 'stage', new Set(stages.filter((s) => s.uid !== current.uid).map((s) => s.key))) } : {}),
                      });
                    }}
                  />
                </Labelled>
                <Labelled label="Name, for the student" error={issues[`stages.${selected}.clientLabel`]}>
                  <input className={INPUT} value={current.clientLabel} onChange={(e) => patch({ clientLabel: e.target.value })} />
                </Labelled>
                <Labelled label="What the student is told" className="sm:col-span-2">
                  <textarea className={AREA} rows={2} value={current.clientDescription} onChange={(e) => patch({ clientDescription: e.target.value })} placeholder="One plain sentence about what is happening now." />
                </Labelled>
                <Labelled label="Counts as" hint="Which of the ten steps dashboards and reports read it as." error={issues[`stages.${selected}.category`]}>
                  <select className={INPUT} value={current.category} onChange={(e) => patch({ category: e.target.value as Stage })}>
                    {STAGES.map((st) => (
                      <option key={st} value={st}>
                        {STAGE_DEFINITIONS[st].label}
                      </option>
                    ))}
                  </select>
                </Labelled>
                <Labelled label="Key" hint="Stays the same across versions, so applications keep their place." error={issues[`stages.${selected}.key`]}>
                  <input
                    className={cx(INPUT, 'font-mono text-[12.5px]')}
                    value={current.key}
                    onChange={(e) => patch({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'), isNew: false } as Partial<Draft>)}
                  />
                </Labelled>
                <Labelled label="Stuck after" hint="Days without movement before it is flagged." error={issues[`stages.${selected}.slaDays`]}>
                  <div className="flex items-center gap-2">
                    <input className={cx(INPUT, 'w-24')} type="number" min={1} max={3650} value={current.slaDays} onChange={(e) => patch({ slaDays: Number(e.target.value) })} />
                    <span className="text-[13px] text-ink-500">days</span>
                  </div>
                </Labelled>
                <Labelled label="Colour">
                  <div className="flex flex-wrap gap-1.5">
                    {WORKFLOW_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={c}
                        aria-pressed={current.color === c}
                        onClick={() => patch({ color: c })}
                        className={cx('size-7 rounded-full ring-2 ring-offset-2 ring-offset-paper', STAGE_COLOR_DOT[c], current.color === c ? 'ring-ink-700' : 'ring-transparent')}
                      />
                    ))}
                  </div>
                </Labelled>
              </div>
              <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-700">
                <input type="checkbox" className="size-4 accent-brand-700" checked={current.notifyStudent} onChange={(e) => patch({ notifyStudent: e.target.checked })} />
                Tell the student when their application reaches this stage
              </label>
            </Section>

            <Section title="Documents" description="Must all be approved before the application leaves this stage.">
              <DocumentPicker
                value={current.requiredDocuments}
                onChange={(v) => patch({ requiredDocuments: v })}
                types={documentTypes}
                labels={labels}
                error={issues[`stages.${selected}.requiredDocuments`]}
              />
              <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-700">
                <input type="checkbox" className="size-4 accent-brand-700" checked={current.autoAdvance} onChange={(e) => patch({ autoAdvance: e.target.checked })} />
                Move on by itself once they are all approved
              </label>
            </Section>

            <Section title="Gates">
              <label className="flex items-start gap-2 text-[13px] text-ink-700">
                <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" checked={current.approvalRequired} onChange={(e) => patch({ approvalRequired: e.target.checked })} />
                <span>
                  Needs sign-off before it moves on
                  <span className="block text-[12px] text-ink-400">A manager, or someone allowed to approve stages, signs it off. Managers are told when an application arrives here.</span>
                </span>
              </label>
              <label className="mt-3 flex items-start gap-2 text-[13px] text-ink-700">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-brand-700"
                  checked={current.movableBy === 'managers'}
                  onChange={(e) => patch({ movableBy: e.target.checked ? 'managers' : 'staff' })}
                />
                <span>
                  Only managers move applications into or out of it
                  <span className="block text-[12px] text-ink-400">For steps like filing the visa, where a second pair of eyes is the rule.</span>
                </span>
              </label>
            </Section>

            <Section title="Applies when" description="Leave empty for every application. Otherwise it is skipped for applications these do not fit.">
              <ConditionsEditor value={current.conditions} onChange={(v) => patch({ conditions: v })} fields={STAGE_CONDITION_FIELDS} empty="Applies to every application." />
            </Section>

            <Section title="When an application arrives" description="Created and sent automatically. Each run is in the automation log.">
              <p className="mb-1.5 text-[12.5px] font-medium text-ink-700">Tasks</p>
              <TasksEditor value={current.tasks} onChange={(v) => patch({ tasks: v })} />
              <p className="mb-1.5 mt-4 text-[12.5px] font-medium text-ink-700">Fees</p>
              <FeesEditor value={current.fees} onChange={(v) => patch({ fees: v })} />
              <p className="mb-1.5 mt-4 text-[12.5px] font-medium text-ink-700">Messages</p>
              <MessagesEditor value={current.messages} onChange={(v) => patch({ messages: v })} />
            </Section>

            {current.conditions.length > 0 && (
              <p className="text-[12px] text-ink-400">Applies when {current.conditions.map(describeCondition).join(' and ').toLowerCase()}.</p>
            )}
          </fieldset>
        )}
      </div>

      <Modal open={publishing} onClose={() => setPublishing(false)} title="Publish this workflow" description="New applications start on it at once. Published versions never change; later edits become the next version.">
        <div className="space-y-3">
          <label className="block text-[13px] font-medium text-ink-700">
            What changed
            <textarea className={cx(AREA, 'mt-1')} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Added the PAL step" />
          </label>
          {hasPublished && (
            <label className="flex items-start gap-2 text-[13px] text-ink-700">
              <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" checked={upgrade} onChange={(e) => setUpgrade(e.target.checked)} />
              <span>
                Move open applications on earlier versions to this one
                <span className="block text-[12px] text-ink-400">
                  {openOnOlderVersions} open application{openOnOlderVersions === 1 ? '' : 's'}. Each keeps its place: the same stage, or the first one of the same kind.
                </span>
              </span>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPublishing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={publish} disabled={busy}>
              {busy ? 'Publishing…' : 'Publish'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function describeIssues(found: Record<string, string>, stages: Draft[]): string {
  const lines = Object.entries(found).map(([path, msg]) => {
    const [, index] = path.split('.');
    const n = Number(index);
    return Number.isFinite(n) && stages[n] ? `Stage ${n + 1} (${stages[n]!.name}): ${msg}` : msg;
  });
  return lines.slice(0, 3).join(' ') + (lines.length > 3 ? ` And ${lines.length - 3} more.` : '');
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-4 first-of-type:border-t-0 first-of-type:pt-0">
      <h4 className="text-[14px] font-medium text-ink-950">{title}</h4>
      {description && <p className="mb-2 mt-0.5 text-[12.5px] text-ink-500">{description}</p>}
      <div className={description ? '' : 'mt-2'}>{children}</div>
    </section>
  );
}

function Labelled({ label, hint, error, className, children }: { label: string; hint?: string; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <span className="mb-1 block text-[12.5px] font-medium text-ink-700">{label}</span>
      {children}
      {error ? <p className="mt-1 text-[12px] text-bad-700">{error}</p> : hint ? <p className="mt-1 text-[11.5px] text-ink-400">{hint}</p> : null}
    </div>
  );
}

function DocumentPicker({
  value,
  onChange,
  types,
  labels,
  error,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  types: { key: string; label: string }[];
  labels: Map<string, string>;
  error?: string;
}) {
  const [q, setQ] = useState('');
  const shown = types.filter((t) => !q || t.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onChange(value.filter((x) => x !== k))}
              className="rounded-full bg-brand-50 px-2.5 py-1 text-[12px] font-medium text-brand-800 ring-1 ring-brand-200 hover:bg-bad-50 hover:text-bad-700 hover:ring-bad-200"
              title="Remove"
            >
              {labels.get(k) ?? k} ×
            </button>
          ))}
        </div>
      )}
      <input className={cx(INPUT, 'mb-2 max-w-xs')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a document type" />
      <div className="grid max-h-48 gap-x-4 gap-y-1 overflow-y-auto sm:grid-cols-2">
        {shown.map((t) => (
          <label key={t.key} className="flex items-center gap-2 text-[13px] text-ink-700">
            <input
              type="checkbox"
              className="size-4 accent-brand-700"
              checked={value.includes(t.key)}
              onChange={(e) => onChange(e.target.checked ? [...value, t.key] : value.filter((x) => x !== t.key))}
            />
            {t.label}
          </label>
        ))}
      </div>
      {error && <p className="mt-1 text-[12px] text-bad-700">{error}</p>}
    </div>
  );
}
