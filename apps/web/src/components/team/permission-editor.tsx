'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_META,
  type ConsultancyDefaults,
  type MemberPermissions,
  type Permission,
  type PermissionChoice,
  type RoleTemplateView,
} from '@crm/shared';
import { Button, Pill, cx } from '../ui';
import { callApi, Field, FormAlert, TextInput } from '../forms';
import { IconCheck, IconClose, IconLock } from '../icons';

type Props =
  | { mode: 'member'; member: MemberPermissions; modules?: string[] }
  | { mode: 'consultancy'; defaults: ConsultancyDefaults; modules?: string[] }
  | { mode: 'role'; role: RoleTemplateView | null; defaults: ConsultancyDefaults; modules?: string[] };

type Choices = Record<Permission, PermissionChoice>;

function initialChoices(props: Props): Choices {
  const out = {} as Choices;
  if (props.mode === 'member') {
    for (const r of props.member.rows) out[r.key] = r.override ?? 'inherit';
  } else if (props.mode === 'role') {
    for (const p of PERMISSIONS) out[p] = props.role?.effects[p] ?? 'inherit';
  } else {
    for (const r of props.defaults.rows) out[r.key] = r.source === 'consultancy' ? (r.allowed ? 'allow' : 'deny') : 'inherit';
  }
  return out;
}

function inheritedValues(props: Props): Record<Permission, boolean> {
  const out = {} as Record<Permission, boolean>;
  if (props.mode === 'member') {
    for (const r of props.member.rows) out[r.key] = r.inherited;
  } else if (props.mode === 'role') {
    for (const r of props.defaults.rows) out[r.key] = r.allowed;
  } else {
    for (const p of PERMISSIONS) out[p] = PERMISSION_META[p].consultantDefault;
  }
  return out;
}

/**
 * Who may do what, one permission at a time.
 *
 * Each permission is Default, Allow or Deny. Default follows the layer
 * above - for a person, the consultancy's default for consultants; for the
 * consultancy, the built-in default - so a manager only has to say what is
 * different. Nothing changes until Save, and "Preview access" shows the
 * result, in plain words and as the menu they will see, before it is saved.
 * Changes apply on the person's very next click, and each one is recorded in
 * the audit trail.
 */
export function PermissionEditor(props: Props) {
  const router = useRouter();
  const [saved, setSaved] = useState<Choices>(() => initialChoices(props));
  const [choices, setChoices] = useState<Choices>(saved);
  const [inherited, setInherited] = useState(() => inheritedValues(props));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [preview, setPreview] = useState(false);

  const fixed = props.mode === 'member' && props.member.fixed;
  const firstName =
    props.mode === 'member' ? props.member.name.split(' ')[0] : props.mode === 'role' ? 'Its members' : 'Consultants';

  // A role also has a name, a description and whether it takes clients.
  const initialMeta = {
    name: props.mode === 'role' ? (props.role?.name ?? '') : '',
    description: props.mode === 'role' ? (props.role?.description ?? '') : '',
    takesClients: props.mode === 'role' ? (props.role?.takesClients ?? true) : true,
  };
  const [savedMeta, setSavedMeta] = useState(initialMeta);
  const [meta, setMeta] = useState(initialMeta);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const isNewRole = props.mode === 'role' && !props.role;
  const metaDirty =
    props.mode === 'role' &&
    (meta.name !== savedMeta.name ||
      meta.description !== savedMeta.description ||
      meta.takesClients !== savedMeta.takesClients);

  const changed = useMemo(
    () => PERMISSIONS.filter((p) => choices[p] !== saved[p]),
    [choices, saved],
  );
  const effective = (p: Permission) => (choices[p] === 'inherit' ? inherited[p] : choices[p] === 'allow');

  async function saveRole() {
    if (props.mode !== 'role') return;
    setBusy(true);
    setNote(null);
    setFieldErrors({});
    const effects = Object.fromEntries(
      PERMISSIONS.filter((p) => choices[p] !== 'inherit').map((p) => [p, choices[p]]),
    );
    const res = await callApi<RoleTemplateView>(props.role ? `/api/team/roles/${props.role.id}` : '/api/team/roles', {
      method: props.role ? 'PATCH' : 'POST',
      json: {
        name: meta.name.trim(),
        description: meta.description.trim() || null,
        takesClients: meta.takesClients,
        effects,
      },
    });
    setBusy(false);
    if (!res.ok || !res.data) {
      setFieldErrors(res.fieldErrors);
      setNote({ tone: 'bad', text: res.message ?? 'The role could not be saved.' });
      return;
    }
    if (!props.role) {
      router.push(`/overview/roles/${res.data.id}`);
      return;
    }
    setSaved(choices);
    setSavedMeta(meta);
    setNote({ tone: 'ok', text: 'Saved. Everyone with this role has the new access from their next click.' });
    router.refresh();
  }

  async function save() {
    if (props.mode === 'role') return saveRole();
    setBusy(true);
    setNote(null);
    const url =
      props.mode === 'member' ? `/api/team/${props.member.userId}/permissions` : '/api/team/defaults';
    const res = await callApi<MemberPermissions | ConsultancyDefaults>(url, {
      method: 'PUT',
      json: { changes: Object.fromEntries(changed.map((p) => [p, choices[p]])) },
    });
    setBusy(false);
    if (!res.ok || !res.data) {
      setNote({ tone: 'bad', text: res.message ?? 'Those changes could not be saved.' });
      return;
    }
    const next = props.mode === 'member' ? { ...props, member: res.data as MemberPermissions } : { ...props, defaults: res.data as ConsultancyDefaults };
    const fresh = initialChoices(next as Props);
    setSaved(fresh);
    setChoices(fresh);
    setInherited(inheritedValues(next as Props));
    setNote({
      tone: 'ok',
      text:
        props.mode === 'member'
          ? `Saved. ${firstName} has the new access from their next click.`
          : 'Saved. Every consultant without their own setting has the new default from their next click.',
    });
    router.refresh();
  }

  if (fixed) {
    return (
      <div className="rounded-xl bg-paper p-5 shadow-card">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <IconLock size={19} />
          </span>
          <div>
            <p className="text-[15px] font-semibold text-ink-950">{props.member.name} is a manager</p>
            <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-ink-500">
              Managers own the consultancy and always have every permission. Nobody - including
              another manager - can restrict them, so the consultancy can never be locked out of its
              own data. Use permissions to shape what consultants can do.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] leading-relaxed text-ink-500">
          {props.mode === 'member' ? (
            <>
              <span className="font-medium text-ink-700">Default</span> follows{' '}
              {props.member.roleName ? (
                <>
                  their role, <span className="font-medium text-ink-700">{props.member.roleName}</span>, then{' '}
                </>
              ) : null}
              the consultancy’s default for consultants. Choose Allow or Deny only where {firstName} should be
              different.
            </>
          ) : props.mode === 'role' ? (
            <>
              <span className="font-medium text-ink-700">Default</span> follows the consultancy’s default for
              consultants. Allow or Deny what this role changes; a person’s own setting still wins over it.
            </>
          ) : (
            <>
              <span className="font-medium text-ink-700">Default</span> is the built-in, recommended setting.
            </>
          )}
        </p>
        <Button variant={preview ? 'primary' : 'secondary'} size="sm" onClick={() => setPreview((v) => !v)}>
          {preview ? 'Hide preview' : 'Preview access'}
        </Button>
      </div>

      {props.mode === 'role' && (
        <section className="rounded-xl bg-paper p-4 shadow-card sm:p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Role name" required error={fieldErrors.name}>
              <TextInput
                value={meta.name}
                onChange={(v) => setMeta((m) => ({ ...m, name: v }))}
                placeholder="e.g. Visa officer"
                invalid={Boolean(fieldErrors.name)}
              />
            </Field>
            <Field label="What it is for" error={fieldErrors.description}>
              <TextInput
                value={meta.description}
                onChange={(v) => setMeta((m) => ({ ...m, description: v }))}
                placeholder="One line, shown on the roles list"
              />
            </Field>
          </div>
          <label className="mt-3 flex items-start gap-2 text-[13.5px] text-ink-700">
            <input
              type="checkbox"
              checked={meta.takesClients}
              onChange={(e) => setMeta((m) => ({ ...m, takesClients: e.target.checked }))}
              className="mt-0.5 size-4 accent-brand-700"
            />
            <span>
              <span className="font-medium text-ink-900">Takes clients.</span> People with this role can be
              assigned students. Leave it off for accountants, trainers and anyone without a caseload.
            </span>
          </label>
        </section>
      )}

      {preview && (
        <AccessPreview
          who={
            props.mode === 'member'
              ? props.member.name
              : props.mode === 'role'
                ? meta.name || 'This role'
                : 'A consultant'
          }
          allowed={effective}
          modules={props.modules}
        />
      )}

      {note && <FormAlert tone={note.tone}>{note.text}</FormAlert>}

      <div className="grid gap-4 xl:grid-cols-2">
        {PERMISSION_GROUPS.map((g) => (
          <section key={g.key} className="overflow-hidden rounded-xl bg-paper shadow-card">
            <h3 className="border-b border-line px-4 py-3 text-[14px] font-semibold text-ink-950 sm:px-5">{g.label}</h3>
            <ul className="divide-y divide-line">
              {g.permissions.map((meta) => {
                const p = meta.key;
                const on = effective(p);
                const dirty = choices[p] !== saved[p];
                return (
                  <li key={p} className={cx('px-4 py-3 sm:px-5', dirty && 'bg-brand-50/40')}>
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0 flex-1 basis-60">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={cx(
                              'flex size-5 items-center justify-center rounded-full',
                              on ? 'bg-ok-100 text-ok-700' : 'bg-ink-100 text-ink-400',
                            )}
                            aria-hidden
                          >
                            {on ? <IconCheck size={12} strokeWidth={2.5} /> : <IconClose size={12} strokeWidth={2.5} />}
                          </span>
                          <span className="text-[14px] font-medium text-ink-900">{meta.label}</span>
                          {meta.sensitive && <Pill tone="warn">Sensitive</Pill>}
                        </div>
                        <p className="mt-0.5 pl-6.5 text-[12.5px] leading-snug text-ink-500">{meta.description}</p>
                      </div>
                      <Segmented
                        label={meta.label}
                        value={choices[p]}
                        inheritedOn={inherited[p]}
                        onChange={(v) => setChoices((c) => ({ ...c, [p]: v }))}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {(changed.length > 0 || metaDirty || isNewRole) && (
        <div className="sticky bottom-20 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-paper px-4 py-3 shadow-raise lg:bottom-4">
          <p className="text-[13.5px] text-ink-700">
            {isNewRole ? (
              <span className="font-semibold">A new role, not saved yet</span>
            ) : (
              <>
                <span className="font-semibold">{changed.length + (metaDirty ? 1 : 0)}</span> unsaved{' '}
                {changed.length + (metaDirty ? 1 : 0) === 1 ? 'change' : 'changes'}:{' '}
                <span className="text-ink-500">
                  {[
                    ...(metaDirty ? ['name and details'] : []),
                    ...changed.map((p) => PERMISSION_META[p].label.toLowerCase()),
                  ].join(', ')}
                </span>
              </>
            )}
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setChoices(saved);
                setMeta(savedMeta);
              }}
              disabled={busy}
            >
              Discard
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : isNewRole ? 'Create role' : 'Save changes'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Segmented({
  label,
  value,
  inheritedOn,
  onChange,
}: {
  label: string;
  value: PermissionChoice;
  inheritedOn: boolean;
  onChange: (v: PermissionChoice) => void;
}) {
  const options: { v: PermissionChoice; text: string; tone: string }[] = [
    { v: 'inherit', text: `Default · ${inheritedOn ? 'on' : 'off'}`, tone: 'text-ink-800' },
    { v: 'allow', text: 'Allow', tone: 'text-ok-700' },
    { v: 'deny', text: 'Deny', tone: 'text-bad-700' },
  ];
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-lg bg-ink-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={cx(
            'h-7 whitespace-nowrap rounded-md px-2.5 text-[12.5px] font-medium transition-colors',
            value === o.v ? cx('bg-paper shadow-card', o.tone) : 'text-ink-500 hover:text-ink-800',
          )}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

/** The menu a consultant sees, from their permissions - the same rules the desk uses. */
function deskMenu(allowed: (p: Permission) => boolean, modules?: string[]): string[] {
  const has = (m: string) => !modules || modules.includes(m);
  return [
    'Dashboard',
    allowed('client.view_all') ? 'All clients' : 'Clients',
    ...(allowed('document.view') ? ['To review'] : []),
    ...(allowed('chat.view') ? ['Messages'] : []),
    ...(has('tasks') ? ['Tasks'] : []),
    ...(has('billing') && allowed('billing.view') ? ['Invoices'] : []),
    'My workload',
    ...(allowed('staff.view') ? ['Team'] : []),
    ...(allowed('audit.view') ? ['Audit trail'] : []),
    ...(allowed('data.export') ? ['Export'] : []),
  ];
}

/**
 * What this person would be able to do, with the unsaved changes applied.
 * Nothing is saved or switched by looking: it is the answer to "what does Deny
 * on this actually take away" before committing to it.
 */
function AccessPreview({
  who,
  allowed,
  modules,
}: {
  who: string;
  allowed: (p: Permission) => boolean;
  modules?: string[];
}) {
  const yes = PERMISSIONS.filter(allowed);
  const no = PERMISSIONS.filter((p) => !allowed(p));
  const first = who.split(' ')[0];
  return (
    <section className="rounded-xl border border-brand-200 bg-brand-50/50 p-4 sm:p-5" aria-label="Access preview">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-brand-700">Preview · not saved</p>
      <p className="mt-1 text-[14px] text-ink-800">
        {allowed('client.view_all') ? (
          <>
            {first} sees <span className="font-semibold">every client</span> in the consultancy.
          </>
        ) : (
          <>
            {first} sees <span className="font-semibold">only the clients assigned to them</span>, and their
            applications, documents and conversations.
          </>
        )}
      </p>

      <div className="mt-3">
        <p className="text-[12px] font-medium text-ink-500">Their menu</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {deskMenu(allowed, modules).map((m) => (
            <span key={m} className="rounded-md bg-rail-900 px-2 py-1 text-[12px] font-medium text-rail-ink">
              {m}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-[12px] font-medium text-ok-700">Can ({yes.length})</p>
          <ul className="mt-1 space-y-0.5 text-[13px] text-ink-700">
            {yes.map((p) => (
              <li key={p} className="flex items-center gap-1.5">
                <IconCheck size={13} className="shrink-0 text-ok-600" /> {PERMISSION_META[p].label}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[12px] font-medium text-bad-700">Cannot ({no.length})</p>
          <ul className="mt-1 space-y-0.5 text-[13px] text-ink-500">
            {no.length === 0 ? (
              <li>Nothing is held back.</li>
            ) : (
              no.map((p) => (
                <li key={p} className="flex items-center gap-1.5">
                  <IconClose size={13} className="shrink-0 text-bad-600" /> {PERMISSION_META[p].label}
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
      <p className="mt-3 text-[12px] text-ink-400">
        Always, whatever is set here: they cannot change anyone’s permissions, and managers keep full access.
      </p>
    </section>
  );
}
