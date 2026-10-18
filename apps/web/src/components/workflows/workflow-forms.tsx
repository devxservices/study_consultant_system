'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { STUDY_LEVELS, type WorkflowSummaryView } from '@crm/shared';
import { Button, Card } from '../ui';
import { callApi, Field, FormAlert, SelectInput, TextArea, TextInput } from '../forms';
import { Modal } from '../modal';
import { IconPlus } from '../icons';

const LEVEL_LABEL: Record<string, string> = {
  foundation: 'Foundation',
  diploma: 'Diploma',
  bachelor: 'Bachelor’s',
  master: 'Master’s',
  phd: 'PhD',
  other: 'Other',
};

interface Aim {
  name: string;
  description: string;
  country: string;
  studyLevel: string;
  visaType: string;
}

function AimFields({
  value,
  onChange,
  countries,
  errors,
  fixed = false,
}: {
  value: Aim;
  onChange: (v: Aim) => void;
  countries: string[];
  errors: Record<string, string>;
  /** The Standard workflow: only its name and description change. */
  fixed?: boolean;
}) {
  const set = (k: keyof Aim) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name" required error={errors.name} className="sm:col-span-2">
        <TextInput value={value.name} onChange={set('name')} placeholder="e.g. Canada study permit" invalid={Boolean(errors.name)} />
      </Field>
      <Field label="Description" className="sm:col-span-2">
        <TextArea value={value.description} onChange={set('description')} rows={2} placeholder="Who it is for, in a sentence." />
      </Field>
      {!fixed && (
        <>
          <Field label="For applications to" hint="Leave empty for any destination." error={errors.country}>
            <SelectInput value={value.country} onChange={set('country')} placeholder="Any country" options={countries.map((c) => ({ value: c, label: c }))} />
          </Field>
          <Field label="Study level" hint="Only for this level, if set." error={errors.studyLevel}>
            <SelectInput value={value.studyLevel} onChange={set('studyLevel')} placeholder="Any level" options={STUDY_LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l] ?? l }))} />
          </Field>
          <Field label="Visa type" hint="Only for this route, if set." error={errors.visaType} className="sm:col-span-2">
            <TextInput value={value.visaType} onChange={set('visaType')} placeholder="Any visa type" />
          </Field>
        </>
      )}
    </div>
  );
}

const payload = (a: Aim) => ({
  name: a.name.trim(),
  description: a.description.trim() || undefined,
  country: a.country || null,
  studyLevel: a.studyLevel || null,
  visaType: a.visaType.trim() || null,
});

export function NewWorkflowButton({ base, countries, workflows }: { base: string; countries: string[]; workflows: WorkflowSummaryView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [aim, setAim] = useState<Aim>({ name: '', description: '', country: '', studyLevel: '', visaType: '' });
  const [copyFrom, setCopyFrom] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setErrors({});
    setError(null);
    const res = await callApi<{ id: string }>('/api/workflows', { method: 'POST', json: { ...payload(aim), copyFromId: copyFrom || undefined } });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors);
      setError(res.message);
      return;
    }
    router.push(`${base}/workflows/${res.data!.id}`);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <IconPlus size={16} />
        New workflow
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="New workflow" description="It starts as a draft copy of another workflow's stages, ready to change." wide>
        <div className="space-y-4">
          {error && <FormAlert>{error}</FormAlert>}
          <AimFields value={aim} onChange={setAim} countries={countries} errors={errors} />
          <Field label="Start from">
            <SelectInput
              value={copyFrom}
              onChange={setCopyFrom}
              placeholder="The Standard stages"
              options={workflows.filter((w) => !w.isDefault).map((w) => ({ value: w.id, label: `A copy of ${w.name}` }))}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={create} disabled={busy || aim.name.trim().length < 2}>
              {busy ? 'Creating…' : 'Create draft'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function WorkflowDetailsForm({
  workflow,
  countries,
  canEdit,
}: {
  workflow: WorkflowSummaryView;
  countries: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [aim, setAim] = useState<Aim>({
    name: workflow.name,
    description: workflow.description ?? '',
    country: workflow.country ?? '',
    studyLevel: workflow.studyLevel ?? '',
    visaType: workflow.visaType ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setErrors({});
    setNote(null);
    const res = await callApi(`/api/workflows/${workflow.id}`, { method: 'PATCH', json: payload(aim) });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors);
      setNote({ tone: 'bad', text: res.message ?? 'Could not save.' });
      return;
    }
    setNote({ tone: 'ok', text: 'Saved. New applications are matched to workflows with these details.' });
    router.refresh();
  }

  async function archive(archived: boolean) {
    if (archived && !window.confirm('Archive this workflow? Applications already on it carry on; new ones will not use it.')) return;
    setBusy(true);
    const res = await callApi(`/api/workflows/${workflow.id}/${archived ? 'archive' : 'restore'}`, { method: 'POST' });
    setBusy(false);
    if (!res.ok) setNote({ tone: 'bad', text: res.message ?? 'Could not do that.' });
    else router.refresh();
  }

  return (
    <Card className="max-w-3xl p-4 sm:p-5">
      <fieldset disabled={!canEdit} className="space-y-4">
        {note && <FormAlert tone={note.tone}>{note.text}</FormAlert>}
        {workflow.isDefault && (
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-[13px] text-ink-600">
            Standard is the fallback: any application no other workflow fits runs on it, so it is not aimed at one country.
          </p>
        )}
        <AimFields value={aim} onChange={setAim} countries={countries} errors={errors} fixed={workflow.isDefault} />
        {canEdit && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
            <Button onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save details'}
            </Button>
            {!workflow.isDefault &&
              (workflow.archived ? (
                <Button variant="secondary" onClick={() => archive(false)} disabled={busy}>
                  Restore workflow
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => archive(true)} disabled={busy}>
                  Archive workflow
                </Button>
              ))}
          </div>
        )}
        {!canEdit && <p className="text-[12.5px] text-ink-400">Changing workflows needs the “Build workflows” permission.</p>}
      </fieldset>
    </Card>
  );
}
