'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  RENAME_TOKENS,
  SYSTEM_FOLDERS,
  UPLOAD_TYPES,
  renameForDownload,
  type DocumentTypeView,
  type DriveSettingsView,
  type FolderTemplateView,
  type RequirementSetView,
  type UploadTypeKey,
} from '@crm/shared';
import { Button, Card, Pill, cx } from '../ui';
import { callApi, Field, FormAlert, TextInput } from '../forms';
import { IconArrowDown, IconArrowUp, IconClose, IconPlus } from '../icons';

const input = 'h-9 w-full rounded-lg border border-line-strong bg-paper px-2.5 text-[13.5px] text-ink-900';

function useSave() {
  const router = useRouter();
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  async function save(url: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', json?: unknown, ok = 'Saved.'): Promise<boolean> {
    setBusy(true);
    setNote(null);
    setFieldErrors({});
    const res = await callApi(url, { method, json });
    setBusy(false);
    if (!res.ok) {
      setFieldErrors(res.fieldErrors);
      setNote({ tone: 'bad', text: res.message ?? Object.values(res.fieldErrors)[0] ?? 'Could not save.' });
      return false;
    }
    setNote({ tone: 'ok', text: ok });
    router.refresh();
    return true;
  }
  return { save, note, busy, fieldErrors };
}

/* ------------------------------------------------------------------ */
/* Uploads and housekeeping                                            */
/* ------------------------------------------------------------------ */

export function DriveSettingsForm({ initial }: { initial: DriveSettingsView }) {
  const [accepted, setAccepted] = useState<UploadTypeKey[]>(initial.acceptedTypes);
  const [maxMb, setMaxMb] = useState(String(initial.maxFileMb));
  const [pattern, setPattern] = useState(initial.renamePattern);
  const [retention, setRetention] = useState(String(initial.retentionDays));
  const [reminders, setReminders] = useState(initial.expiryReminderDays.join(', '));
  const { save, note, busy } = useSave();
  const example = renameForDownload(pattern, {
    studentName: 'Ali Khan',
    typeLabel: 'Passport',
    uploadedAt: new Date().toISOString(),
    caseReference: 'APP-2026-0042',
    fileName: 'IMG_2041.pdf',
    version: 2,
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    await save('/api/drive/settings', 'PUT', {
      acceptedTypes: accepted,
      maxFileMb: Number(maxMb),
      renamePattern: pattern.trim(),
      retentionDays: Number(retention),
      expiryReminderDays: reminders
        .split(',')
        .map((v) => Number(v.trim()))
        .filter((n) => Number.isFinite(n)),
    });
  }

  return (
    <Card className="p-4 sm:p-5">
      <form onSubmit={submit} className="space-y-5">
        {note && <FormAlert tone={note.tone}>{note.text}</FormAlert>}
        <fieldset>
          <legend className="text-[13.5px] font-semibold text-ink-900">Files people may upload</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {UPLOAD_TYPES.map((t) => (
              <label key={t.key} className="flex items-center gap-1.5 text-[13.5px] text-ink-700">
                <input
                  type="checkbox"
                  checked={accepted.includes(t.key)}
                  onChange={(e) => setAccepted(e.target.checked ? [...accepted, t.key] : accepted.filter((k) => k !== t.key))}
                  className="size-4 accent-brand-700"
                />
                {t.label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[12px] text-ink-500">Checked by the file’s contents, not its name - a renamed file of another kind is refused.</p>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Largest file, in MB" hint="Up to 25">
            <TextInput value={maxMb} onChange={setMaxMb} inputMode="numeric" />
          </Field>
          <Field label="Keep removed files for (days)" hint="Then they are deleted for good">
            <TextInput value={retention} onChange={setRetention} inputMode="numeric" />
          </Field>
          <Field label="Expiry reminders, days before" hint="e.g. 90, 30, 7, 0">
            <TextInput value={reminders} onChange={setReminders} />
          </Field>
        </div>
        <Field label="Name files are downloaded under" hint={<>Use {RENAME_TOKENS.join(' ')}. Example: <span className="font-medium text-ink-800">{example}</span></>}>
          <TextInput value={pattern} onChange={setPattern} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || accepted.length === 0}>
            {busy ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Document types                                                      */
/* ------------------------------------------------------------------ */

const FOLDER_OPTIONS = SYSTEM_FOLDERS.map((f) => ({ value: f.key, label: f.name }));

export function DocumentTypesEditor({ types }: { types: DocumentTypeView[] }) {
  const [editing, setEditing] = useState<DocumentTypeView | 'new' | null>(null);
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="overflow-hidden">
        <ul className="divide-y divide-line">
          {types.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium text-ink-900">
                  {t.label}
                  {!t.system && <Pill tone="info">Your own</Pill>}
                  {t.hasExpiry && <Pill tone="neutral">Expires</Pill>}
                  {!t.active && <Pill tone="neutral">Hidden</Pill>}
                </p>
                <p className="truncate text-[12px] text-ink-500">
                  {t.key} · filed in {SYSTEM_FOLDERS.find((f) => f.key === t.folderKey)?.name ?? t.folderKey}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                Edit
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-4 sm:p-5">
        {editing ? (
          <TypeForm key={editing === 'new' ? 'new' : editing.id} type={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        ) : (
          <div>
            <p className="text-[15px] font-semibold text-ink-950">Document types</p>
            <p className="mt-1 text-[13px] text-ink-500">What students send, how it is labelled, which folder it goes into, and whether it expires.</p>
            <Button className="mt-4" onClick={() => setEditing('new')}>
              <IconPlus size={16} />
              Add a type
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function TypeForm({ type, onDone }: { type: DocumentTypeView | null; onDone: () => void }) {
  const [key, setKey] = useState(type?.key ?? '');
  const [label, setLabel] = useState(type?.label ?? '');
  const [hint, setHint] = useState(type?.hint ?? '');
  const [folderKey, setFolderKey] = useState(type?.folderKey ?? 'other');
  const [hasExpiry, setHasExpiry] = useState(type?.hasExpiry ?? false);
  const [active, setActive] = useState(type?.active ?? true);
  const { save, note, busy, fieldErrors } = useSave();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await save(type ? `/api/drive/types/${type.id}` : '/api/drive/types', type ? 'PATCH' : 'POST', {
      key: key.trim(),
      label: label.trim(),
      hint: hint.trim() || null,
      folderKey,
      hasExpiry,
      active,
    });
    if (ok) onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-[15px] font-semibold text-ink-950">{type ? 'Edit type' : 'New type'}</p>
      {note && <FormAlert tone={note.tone}>{note.text}</FormAlert>}
      <Field label="Name" required error={fieldErrors.label}>
        <TextInput value={label} onChange={(v) => { setLabel(v); if (!type) setKey(v.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)); }} />
      </Field>
      {!type && (
        <Field label="Key" hint="Used in reports and integrations; cannot change later" error={fieldErrors.key}>
          <TextInput value={key} onChange={setKey} />
        </Field>
      )}
      <Field label="Hint for students">
        <TextInput value={hint} onChange={setHint} placeholder="What to photograph or scan" />
      </Field>
      <Field label="Filed in">
        <select value={folderKey} onChange={(e) => setFolderKey(e.target.value)} className={input}>
          {FOLDER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <label className="flex items-center gap-2 text-[13px] text-ink-700">
        <input type="checkbox" checked={hasExpiry} onChange={(e) => setHasExpiry(e.target.checked)} className="size-4 accent-brand-700" />
        Has an expiry date (reminders go out before it runs out)
      </label>
      <label className="flex items-center gap-2 text-[13px] text-ink-700">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-brand-700" />
        Offered when uploading
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Folder templates                                                    */
/* ------------------------------------------------------------------ */

export function FolderTemplatesEditor({ templates }: { templates: FolderTemplateView[] }) {
  const [editing, setEditing] = useState<FolderTemplateView | 'new' | null>(null);
  const { save } = useSave();
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card className="overflow-hidden">
        <ul className="divide-y divide-line">
          {templates.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium text-ink-900">
                  {t.name}
                  {t.isDefault && <Pill tone="info">Default</Pill>}
                  {t.country && <Pill tone="neutral">{t.country}</Pill>}
                </p>
                <p className="mt-0.5 text-[12px] text-ink-500">{t.folders.map((f) => f.name).join(' · ')}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                  Edit
                </Button>
                {!t.isDefault && (
                  <Button size="sm" variant="ghost" onClick={() => void save(`/api/drive/folder-templates/${t.id}`, 'DELETE', undefined, 'Removed.')}>
                    Remove
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-4 sm:p-5">
        {editing ? (
          <TemplateForm key={editing === 'new' ? 'new' : editing.id} template={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        ) : (
          <div>
            <p className="text-[15px] font-semibold text-ink-950">Folder templates</p>
            <p className="mt-1 text-[13px] text-ink-500">
              The folders a new student’s drive starts with. A template for a country is used for students applying there; otherwise the default.
            </p>
            <Button className="mt-4" onClick={() => setEditing('new')}>
              <IconPlus size={16} />
              Add a template
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function TemplateForm({ template, onDone }: { template: FolderTemplateView | null; onDone: () => void }) {
  const [name, setName] = useState(template?.name ?? '');
  const [country, setCountry] = useState(template?.country ?? '');
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false);
  const [folders, setFolders] = useState(template?.folders ?? SYSTEM_FOLDERS.map((f) => ({ key: f.key, name: f.name })));
  const { save, note, busy } = useSave();
  const move = (i: number, d: -1 | 1) =>
    setFolders((fs) => {
      const next = [...fs];
      const j = i + d;
      if (j < 0 || j >= next.length) return fs;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await save(template ? `/api/drive/folder-templates/${template.id}` : '/api/drive/folder-templates', template ? 'PATCH' : 'POST', {
      name: name.trim(),
      country: country.trim() || null,
      isDefault,
      folders: folders.map((f) => ({ key: f.key.trim(), name: f.name.trim() })).filter((f) => f.key && f.name),
    });
    if (ok) onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-[15px] font-semibold text-ink-950">{template ? 'Edit template' : 'New template'}</p>
      {note && <FormAlert tone={note.tone}>{note.text}</FormAlert>}
      <Field label="Name" required>
        <TextInput value={name} onChange={setName} placeholder="e.g. Canada study permit" />
      </Field>
      <Field label="For students applying to" hint="Leave empty for any country">
        <TextInput value={country} onChange={setCountry} placeholder="Canada" />
      </Field>
      <div>
        <p className="mb-1 text-[13px] font-medium text-ink-800">Folders</p>
        <ul className="space-y-1.5">
          {folders.map((f, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <input value={f.name} onChange={(e) => setFolders(folders.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={cx(input, 'flex-1')} aria-label="Folder name" />
              <input value={f.key} onChange={(e) => setFolders(folders.map((x, j) => (j === i ? { ...x, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') } : x)))} className={cx(input, 'w-28')} aria-label="Folder key" />
              <button type="button" onClick={() => move(i, -1)} className="rounded p-1 text-ink-400 hover:bg-ink-100" aria-label="Up">
                <IconArrowUp size={14} />
              </button>
              <button type="button" onClick={() => move(i, 1)} className="rounded p-1 text-ink-400 hover:bg-ink-100" aria-label="Down">
                <IconArrowDown size={14} />
              </button>
              <button type="button" onClick={() => setFolders(folders.filter((_, j) => j !== i))} className="rounded p-1 text-ink-400 hover:bg-bad-50 hover:text-bad-700" aria-label="Remove">
                <IconClose size={14} />
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setFolders([...folders, { key: '', name: '' }])} className="mt-2 text-[13px] font-medium text-brand-700 hover:underline">
          Add a folder
        </button>
        <p className="mt-1 text-[12px] text-ink-500">Keys file uploads: passport, academic, language, financial, application, offers, visa, other.</p>
      </div>
      <label className="flex items-center gap-2 text-[13px] text-ink-700">
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="size-4 accent-brand-700" />
        The default template
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Checklists                                                          */
/* ------------------------------------------------------------------ */

export function ChecklistsEditor({ sets, types }: { sets: RequirementSetView[]; types: DocumentTypeView[] }) {
  const [editing, setEditing] = useState<RequirementSetView | 'new' | null>(null);
  const { save } = useSave();
  const label = (k: string) => types.find((t) => t.key === k)?.label ?? k;
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
      <Card className="overflow-hidden">
        <ul className="divide-y divide-line">
          {sets.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium text-ink-900">
                  {s.name}
                  {[s.country, s.studyLevel, s.visaType].filter(Boolean).map((v) => (
                    <Pill key={v} tone="neutral">
                      {v}
                    </Pill>
                  ))}
                  {!s.country && !s.studyLevel && !s.visaType && <Pill tone="info">Everyone else</Pill>}
                  {!s.active && <Pill tone="neutral">Off</Pill>}
                </p>
                <p className="mt-0.5 text-[12px] text-ink-500">
                  {s.items.map((i) => `${label(i.typeKey)}${i.required ? '' : ' (optional)'}`).join(' · ')}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void save(`/api/drive/checklists/${s.id}`, 'DELETE', undefined, 'Removed.')}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-4 sm:p-5">
        {editing ? (
          <ChecklistForm key={editing === 'new' ? 'new' : editing.id} set={editing === 'new' ? null : editing} types={types} onDone={() => setEditing(null)} />
        ) : (
          <div>
            <p className="text-[15px] font-semibold text-ink-950">Required-document checklists</p>
            <p className="mt-1 text-[13px] text-ink-500">
              Each application gets the most specific checklist that fits it - country, level and visa type beat country alone, which beats the
              general list. Students see their completion in their portal.
            </p>
            <Button className="mt-4" onClick={() => setEditing('new')}>
              <IconPlus size={16} />
              Add a checklist
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function ChecklistForm({ set, types, onDone }: { set: RequirementSetView | null; types: DocumentTypeView[]; onDone: () => void }) {
  const [name, setName] = useState(set?.name ?? '');
  const [country, setCountry] = useState(set?.country ?? '');
  const [level, setLevel] = useState(set?.studyLevel ?? '');
  const [visa, setVisa] = useState(set?.visaType ?? '');
  const [active, setActive] = useState(set?.active ?? true);
  const [items, setItems] = useState(set?.items ?? [{ typeKey: 'passport', required: true, note: null }]);
  const { save, note, busy } = useSave();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await save(set ? `/api/drive/checklists/${set.id}` : '/api/drive/checklists', set ? 'PATCH' : 'POST', {
      name: name.trim(),
      country: country.trim() || null,
      studyLevel: level.trim() || null,
      visaType: visa.trim() || null,
      active,
      items: items.map((i) => ({ typeKey: i.typeKey, required: i.required, note: i.note?.trim() || null })),
    });
    if (ok) onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-[15px] font-semibold text-ink-950">{set ? 'Edit checklist' : 'New checklist'}</p>
      {note && <FormAlert tone={note.tone}>{note.text}</FormAlert>}
      <Field label="Name" required>
        <TextInput value={name} onChange={setName} placeholder="e.g. UK student visa - Master's" />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Country">
          <TextInput value={country} onChange={setCountry} placeholder="Any" />
        </Field>
        <Field label="Level">
          <TextInput value={level} onChange={setLevel} placeholder="Any" />
        </Field>
        <Field label="Visa type">
          <TextInput value={visa} onChange={setVisa} placeholder="Any" />
        </Field>
      </div>
      <div>
        <p className="mb-1 text-[13px] font-medium text-ink-800">Documents</p>
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <select value={it.typeKey} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, typeKey: e.target.value } : x)))} className={cx(input, 'flex-1')} aria-label="Document type">
                {types.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
              <label className="flex shrink-0 items-center gap-1 text-[12px] text-ink-600">
                <input type="checkbox" checked={it.required} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} className="size-4 accent-brand-700" />
                Required
              </label>
              <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))} className="rounded p-1 text-ink-400 hover:bg-bad-50 hover:text-bad-700" aria-label="Remove">
                <IconClose size={14} />
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setItems([...items, { typeKey: types[0]?.key ?? 'other', required: true, note: null }])} className="mt-2 text-[13px] font-medium text-brand-700 hover:underline">
          Add a document
        </button>
      </div>
      <label className="flex items-center gap-2 text-[13px] text-ink-700">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-brand-700" />
        In use
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || items.length === 0}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
