'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { FOLDER_COLORS, type DriveFolderView, type DriveListing, type GrantView, type ShareCreated } from '@crm/shared';
import { Modal } from '../modal';
import { Button, cx } from '../ui';
import { callApi, Field, FormAlert, TextInput } from '../forms';
import { IconCheck, IconChevronRight, IconCopy, IconFolder } from '../icons';
import { formatDate } from '@/lib/format';

export const COLOR_DOT: Record<string, string> = {
  slate: 'bg-ink-400',
  blue: 'bg-info-500',
  teal: 'bg-[oklch(0.62_0.11_190)]',
  green: 'bg-ok-500',
  amber: 'bg-warn-500',
  red: 'bg-bad-500',
  purple: 'bg-[oklch(0.58_0.16_300)]',
};

/** A name, plus a colour and (for managers) the restricted switch. */
export function FolderDialog({
  open,
  onClose,
  onSaved,
  parent,
  folder,
  manager,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Where a new folder goes. */
  parent?: { parentId?: string | null; clientId?: string | null };
  /** The folder being edited, if any. */
  folder?: DriveFolderView | null;
  manager: boolean;
}) {
  const [name, setName] = useState(folder?.name ?? '');
  const [color, setColor] = useState<string | null>(folder?.color ?? null);
  const [restricted, setRestricted] = useState(folder?.restricted ?? false);
  const [partners, setPartners] = useState(folder?.sharedWithPartners ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName(folder?.name ?? '');
      setColor(folder?.color ?? null);
      setRestricted(folder?.restricted ?? false);
      setPartners(folder?.sharedWithPartners ?? false);
      setError(null);
    }
  }, [open, folder]);
  const agency = folder ? !folder.clientId : !parent?.clientId;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await callApi(folder ? `/api/drive/folders/${folder.id}` : '/api/drive/folders', {
      method: folder ? 'PATCH' : 'POST',
      json: {
        name: name.trim(),
        color,
        ...(manager ? { restricted } : {}),
        ...(agency ? { sharedWithPartners: partners } : {}),
        ...(folder ? {} : { parentId: parent?.parentId ?? null, clientId: parent?.clientId ?? null }),
      },
    });
    setBusy(false);
    if (!res.ok) return setError(res.message ?? Object.values(res.fieldErrors)[0] ?? 'Could not save.');
    onSaved();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={folder ? 'Folder settings' : 'New folder'}>
      <form onSubmit={submit} className="space-y-4">
        {error && <FormAlert>{error}</FormAlert>}
        <Field label="Name" required>
          <TextInput value={name} onChange={setName} placeholder="e.g. Scholarship documents" />
        </Field>
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink-800">Colour</p>
          <div className="flex flex-wrap gap-2">
            <ColorChip label="None" active={color === null} onClick={() => setColor(null)} className="bg-paper ring-1 ring-line-strong" />
            {FOLDER_COLORS.map((c) => (
              <ColorChip key={c} label={c} active={color === c} onClick={() => setColor(c)} className={COLOR_DOT[c]!} />
            ))}
          </div>
        </div>
        {manager && (
          <label className="flex items-start gap-2 text-[13px] text-ink-700">
            <input type="checkbox" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} className="mt-0.5 size-4 accent-brand-700" />
            <span>
              <span className="font-medium text-ink-900">Restricted.</span> Only managers, and people you give access to, can see it and
              what is in it - not other staff, not the student.
            </span>
          </label>
        )}
        {agency && (
          <label className="flex items-start gap-2 text-[13px] text-ink-700">
            <input type="checkbox" checked={partners} onChange={(e) => setPartners(e.target.checked)} className="mt-0.5 size-4 accent-brand-700" />
            <span>
              <span className="font-medium text-ink-900">Share with partners.</span> It appears in the partner portal’s resource library.
            </span>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
      {manager && folder && (
        <div className="mt-5 border-t border-line pt-4">
          <GrantsEditor resourceType="folder" resourceId={folder.id} />
        </div>
      )}
    </Modal>
  );
}

function ColorChip({ label, active, onClick, className }: { label: string; active: boolean; onClick: () => void; className: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={cx('press flex size-7 items-center justify-center rounded-full text-white', className, active && 'ring-2 ring-brand-500 ring-offset-2 ring-offset-paper')}
    >
      {active && <IconCheck size={13} />}
      <span className="sr-only">{label}</span>
    </button>
  );
}

/**
 * Who has been given access to a folder or document beyond the usual rules -
 * and giving it to someone else. Managers only; every change is audited.
 */
export function GrantsEditor({ resourceType, resourceId }: { resourceType: 'folder' | 'document'; resourceId: string }) {
  const [grants, setGrants] = useState<GrantView[] | null>(null);
  const [staff, setStaff] = useState<{ userId: string; name: string; roleTitle: string | null }[]>([]);
  const [userId, setUserId] = useState('');
  const [access, setAccess] = useState<'view' | 'edit'>('view');
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    fetch(`/api/drive/grants?resourceType=${resourceType}&resourceId=${resourceId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setGrants)
      .catch(() => setGrants([]));
  useEffect(() => {
    void load();
    fetch('/api/consultants?includeInactive=true')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { userId: string; name: string; roleTitle: string | null; active: boolean }[]) => setStaff(rows.filter((r) => r.active)))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceType, resourceId]);

  async function add() {
    setError(null);
    const res = await callApi('/api/drive/grants', { method: 'POST', json: { resourceType, resourceId, userId, access } });
    if (!res.ok) return setError(res.message ?? 'Could not grant access.');
    setUserId('');
    void load();
  }
  async function remove(id: string) {
    await callApi(`/api/drive/grants/${id}`, { method: 'DELETE' });
    void load();
  }

  return (
    <div className="space-y-2">
      <p className="text-[13px] font-medium text-ink-800">People given access</p>
      {error && <FormAlert>{error}</FormAlert>}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {grants === null ? (
          <li className="px-3 py-2 text-[12.5px] text-ink-400">Loading…</li>
        ) : grants.length === 0 ? (
          <li className="px-3 py-2 text-[12.5px] text-ink-500">Nobody beyond the usual rules.</li>
        ) : (
          grants.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
              <span>
                {g.userName} <span className="text-ink-400">· {g.access === 'edit' ? 'can add files' : 'can see'}</span>
              </span>
              <button type="button" onClick={() => void remove(g.id)} className="text-[12.5px] text-bad-700 hover:underline">
                Remove
              </button>
            </li>
          ))
        )}
      </ul>
      <div className="flex flex-wrap gap-2">
        <select value={userId} onChange={(e) => setUserId(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-paper px-2 text-[13px]" aria-label="Team member">
          <option value="">Choose a team member</option>
          {staff.map((s) => (
            <option key={s.userId} value={s.userId}>
              {s.name}
              {s.roleTitle ? ` (${s.roleTitle})` : ''}
            </option>
          ))}
        </select>
        <select value={access} onChange={(e) => setAccess(e.target.value as 'view' | 'edit')} className="h-9 rounded-lg border border-line-strong bg-paper px-2 text-[13px]" aria-label="Access">
          <option value="view">Can see</option>
          <option value="edit">Can add files</option>
        </select>
        <Button size="sm" variant="secondary" onClick={() => void add()} disabled={!userId}>
          Give access
        </Button>
      </div>
    </div>
  );
}

/** One line of text - a new name, a tag, a reason. */
export function TextDialog({
  open,
  onClose,
  title,
  description,
  label,
  initial = '',
  placeholder,
  multiline = false,
  minLength = 1,
  confirm,
  danger = false,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  label: string;
  initial?: string;
  placeholder?: string;
  multiline?: boolean;
  minLength?: number;
  confirm: string;
  danger?: boolean;
  onSubmit: (value: string) => Promise<string | null>;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setValue(initial);
      setError(null);
    }
  }, [open, initial]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const problem = await onSubmit(value.trim());
    setBusy(false);
    if (problem) setError(problem);
    else onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={title} description={description}>
      <form onSubmit={submit} className="space-y-4">
        {error && <FormAlert>{error}</FormAlert>}
        <Field label={label}>
          {multiline ? (
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={3}
              placeholder={placeholder}
              className="w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[14px] text-ink-900"
            />
          ) : (
            <TextInput value={value} onChange={setValue} placeholder={placeholder} />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={busy || value.trim().length < minLength}>
            {busy ? 'Working…' : confirm}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Pick a folder in the same student's drive (or the agency area), walking
 * down into sub-folders. Used to move and to copy.
 */
export function FolderPicker({
  open,
  onClose,
  title,
  confirm,
  clientId,
  excludeId,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  confirm: string;
  clientId: string | null;
  excludeId?: string;
  onPick: (folderId: string | null) => Promise<string | null>;
}) {
  const [trail, setTrail] = useState<{ id: string | null; name: string }[]>([{ id: null, name: clientId ? 'Student’s drive' : 'Agency files' }]);
  const [folders, setFolders] = useState<DriveFolderView[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const here = trail.at(-1)!;

  useEffect(() => {
    if (!open) return;
    setTrail([{ id: null, name: clientId ? 'Student’s drive' : 'Agency files' }]);
    setChosen(null);
    setError(null);
  }, [open, clientId]);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const url = here.id ? `/api/drive?folderId=${here.id}&pageSize=1` : clientId ? `/api/drive?clientId=${clientId}&pageSize=1` : '/api/drive?area=agency&pageSize=1';
    fetch(url, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d: DriveListing) => setFolders((d.folders ?? []).filter((f) => f.id !== excludeId)))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [open, here.id, clientId, excludeId]);

  async function go() {
    setBusy(true);
    const problem = await onPick(chosen ?? here.id);
    setBusy(false);
    if (problem) setError(problem);
    else onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {error && (
        <div className="mb-3">
          <FormAlert>{error}</FormAlert>
        </div>
      )}
      <nav className="mb-2 flex flex-wrap items-center gap-1 text-[12.5px] text-ink-500" aria-label="Folder path">
        {trail.map((t, i) => (
          <span key={`${t.id}-${i}`} className="flex items-center gap-1">
            {i > 0 && <IconChevronRight size={12} />}
            <button type="button" className="hover:text-brand-700" onClick={() => { setTrail(trail.slice(0, i + 1)); setChosen(null); }}>
              {t.name}
            </button>
          </span>
        ))}
      </nav>
      <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
        {folders.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-ink-400">No folders here.</li>}
        {folders.map((f) => (
          <li key={f.id} className={cx('flex items-center gap-2 px-3 py-2', chosen === f.id && 'bg-brand-50')}>
            <button type="button" onClick={() => setChosen(f.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13.5px] text-ink-800">
              <IconFolder size={17} className="shrink-0 text-ink-400" />
              <span className="truncate">{f.name}</span>
            </button>
            {f.folderCount > 0 && (
              <button type="button" onClick={() => { setTrail([...trail, { id: f.id, name: f.name }]); setChosen(null); }} className="rounded p-1 text-ink-400 hover:bg-ink-100" aria-label={`Open ${f.name}`}>
                <IconChevronRight size={15} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={go} disabled={busy || (!chosen && !here.id)}>
          {busy ? 'Working…' : confirm}
        </Button>
      </div>
    </Modal>
  );
}

/** A secure link for someone outside; the token is shown once, here. */
export function ShareDialog({
  open,
  onClose,
  target,
}: {
  open: boolean;
  onClose: () => void;
  target: { documentId?: string; folderId?: string; name: string } | null;
}) {
  const [label, setLabel] = useState('');
  const [days, setDays] = useState('7');
  const [password, setPassword] = useState('');
  const [viewOnly, setViewOnly] = useState(false);
  const [created, setCreated] = useState<ShareCreated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (open) {
      setLabel('');
      setDays('7');
      setPassword('');
      setViewOnly(false);
      setCreated(null);
      setError(null);
      setCopied(false);
    }
  }, [open]);
  const url = created ? `${window.location.origin}/s/${created.token}` : '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    const res = await callApi<ShareCreated>('/api/drive/shares', {
      method: 'POST',
      json: {
        ...(target.documentId ? { documentId: target.documentId } : { folderId: target.folderId }),
        label: label.trim(),
        expiresInDays: Number(days),
        ...(password ? { password } : {}),
        viewOnly,
      },
    });
    setBusy(false);
    if (!res.ok || !res.data) return setError(res.message ?? Object.values(res.fieldErrors)[0] ?? 'Could not create the link.');
    setCreated(res.data);
  }

  return (
    <Modal open={open} onClose={onClose} title={`Share “${target?.name ?? ''}”`} description="A link anyone can open without an account, until it expires or you switch it off. Every open is logged.">
      {created ? (
        <div className="space-y-3">
          <FormAlert tone="ok">Link ready. Copy it now - for security it is not shown again.</FormAlert>
          <div className="flex gap-2">
            <input readOnly value={url} className="h-9.5 min-w-0 flex-1 rounded-lg border border-line-strong bg-ink-50 px-3 text-[13px] text-ink-800" onFocus={(e) => e.target.select()} />
            <Button
              onClick={async () => {
                await navigator.clipboard.writeText(url).catch(() => undefined);
                setCopied(true);
              }}
            >
              <IconCopy size={15} />
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="text-[12.5px] text-ink-500">
            Expires {formatDate(created.expiresAt)}. {created.hasPassword ? 'Send the password separately - not in the same email.' : ''}
          </p>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <FormAlert>{error}</FormAlert>}
          <Field label="Who is it for" required hint="Shown in the access log, e.g. University of Leeds admissions">
            <TextInput value={label} onChange={setLabel} placeholder="University of Leeds admissions" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Expires after">
              <select value={days} onChange={(e) => setDays(e.target.value)} className="h-9.5 w-full rounded-lg border border-line-strong bg-paper px-3 text-[14px]">
                {['1', '3', '7', '14', '30', '90'].map((d) => (
                  <option key={d} value={d}>
                    {d} {d === '1' ? 'day' : 'days'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Password" hint="Optional">
              <TextInput value={password} onChange={setPassword} type="password" placeholder="At least 6 characters" />
            </Field>
          </div>
          <label className="flex items-start gap-2 text-[13px] text-ink-700">
            <input type="checkbox" checked={viewOnly} onChange={(e) => setViewOnly(e.target.checked)} className="mt-0.5 size-4 accent-brand-700" />
            <span>
              <span className="font-medium text-ink-900">View only.</span> They can open it in the browser, with no download button.
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || label.trim().length < 2 || (password.length > 0 && password.length < 6)}>
              {busy ? 'Creating…' : 'Create link'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
