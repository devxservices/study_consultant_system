'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import {
  localIsoDate,
  CURRENCIES,
  KYC_KIND_LABEL,
  KYC_KINDS,
  PARTNER_KIND_LABEL,
  PARTNER_KINDS,
  PARTNER_MEMBER_ROLE_LABEL,
  PARTNER_RULE_BASES,
  PARTNER_RULE_BASIS_HINT,
  PARTNER_RULE_BASIS_LABEL,
  PARTNER_STATUS_LABEL,
  PARTNER_TIER_LABEL,
  PARTNER_TIERS,
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  SHAREABLE_FEE_CATEGORIES,
  STAGE_CONDITION_FIELDS,
  FEE_CATEGORY_LABEL,
  type Condition,
  type PartnerMemberRole,
  type PartnerMemberView,
  type PartnerRuleView,
  type PartnerSettingsView,
  type PartnerStatus,
  type PartnerTier,
  type PartnerView,
} from '@crm/shared';
import { Button, cx } from '../ui';
import { Field, FormAlert, SelectInput, TextArea, TextInput } from '../forms';
import { ConditionsEditor } from '../workflows/editors';
import { usePost } from '../use-post';

const today = () => localIsoDate();
type Option = { id: string; name: string };

/* ------------------------------------------------------------------ */
/* The partner                                                          */
/* ------------------------------------------------------------------ */

export function PartnerForm({ initial, base, staff, parents, canEdit }: { initial: PartnerView | null; base: string; staff: Option[]; parents: Option[]; canEdit: boolean }) {
  const { busy, error, fieldErrors, post } = usePost();
  const [f, setF] = useState({
    name: initial?.name ?? '',
    kind: initial?.kind ?? 'sub_agent',
    contactName: initial?.contactName ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    country: initial?.country ?? 'Pakistan',
    city: initial?.city ?? '',
    address: initial?.address ?? '',
    website: initial?.website ?? '',
    registrationNumber: initial?.registrationNumber ?? '',
    taxId: initial?.taxId ?? '',
    tier: initial?.tier ?? 'standard',
    managerUserId: initial?.managerUserId ?? '',
    parentPartnerId: initial?.parentPartnerId ?? '',
    overridePercent: String(initial?.overridePercent ?? 0),
    withholdingPercent: initial?.withholdingPercent === null || initial?.withholdingPercent === undefined ? '' : String(initial.withholdingPercent),
    currency: initial?.currency ?? 'PKR',
    notes: initial?.notes ?? '',
  });
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const body = {
      ...f,
      managerUserId: f.managerUserId || null,
      parentPartnerId: f.parentPartnerId || null,
      overridePercent: f.parentPartnerId ? Number(f.overridePercent) || 0 : 0,
      withholdingPercent: f.withholdingPercent === '' ? null : Number(f.withholdingPercent),
    };
    const r = await post<{ id: string }>(initial ? `/api/partners/${initial.id}` : '/api/partners', body, initial ? 'PUT' : 'POST', (d) => (initial ? null : `${base}/${d.id}`));
    if (r && initial) setSaved(true);
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Organisation" error={fieldErrors.name}>
          <TextInput value={f.name} onChange={set('name')} />
        </Field>
        <Field label="What they do">
          <SelectInput value={f.kind} onChange={set('kind')} options={PARTNER_KINDS.map((k) => ({ value: k, label: PARTNER_KIND_LABEL[k] }))} />
        </Field>
        <Field label="Contact person" error={fieldErrors.contactName}>
          <TextInput value={f.contactName} onChange={set('contactName')} />
        </Field>
        <Field label="Email" error={fieldErrors.email}>
          <TextInput type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Phone" error={fieldErrors.phone}>
          <TextInput value={f.phone} onChange={set('phone')} />
        </Field>
        <Field label="Website">
          <TextInput value={f.website} onChange={set('website')} />
        </Field>
        <Field label="Country">
          <TextInput value={f.country} onChange={set('country')} />
        </Field>
        <Field label="City">
          <TextInput value={f.city} onChange={set('city')} />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <TextInput value={f.address} onChange={set('address')} />
        </Field>
        <Field label="Registration number">
          <TextInput value={f.registrationNumber} onChange={set('registrationNumber')} />
        </Field>
        <Field label="Tax ID (NTN)">
          <TextInput value={f.taxId} onChange={set('taxId')} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Looked after by" hint="Hears from them; their students go to this consultant">
          <SelectInput value={f.managerUserId} onChange={set('managerUserId')} placeholder="Nobody in particular" options={staff.map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
        <Field label="Paid in">
          <SelectInput value={f.currency} onChange={set('currency')} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label="Tax withheld (%)" hint="Empty: the consultancy's default">
          <TextInput value={f.withholdingPercent} onChange={set('withholdingPercent')} inputMode="decimal" />
        </Field>
        {!initial && (
          <Field label="Tier">
            <SelectInput value={f.tier} onChange={set('tier')} options={PARTNER_TIERS.map((t) => ({ value: t, label: PARTNER_TIER_LABEL[t] }))} />
          </Field>
        )}
        <Field label="Sub-agent of" hint="A master partner earns an override on its students">
          <SelectInput value={f.parentPartnerId} onChange={set('parentPartnerId')} placeholder="Nobody - a partner in its own right" options={parents.filter((p) => p.id !== initial?.id).map((p) => ({ value: p.id, label: p.name }))} />
        </Field>
        {f.parentPartnerId && (
          <Field label="Master's override (%)" error={fieldErrors.overridePercent}>
            <TextInput value={f.overridePercent} onChange={set('overridePercent')} inputMode="decimal" />
          </Field>
        )}
      </div>
      <Field label="Notes" hint="Staff only">
        <TextArea value={f.notes} onChange={set('notes')} rows={3} />
      </Field>
      {error && <FormAlert>{error}</FormAlert>}
      {saved && <FormAlert tone="ok">Saved.</FormAlert>}
      {canEdit && (
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : initial ? 'Save changes' : 'Add partner'}
        </Button>
      )}
    </form>
  );
}

const NEXT_STATUSES: Record<PartnerStatus, PartnerStatus[]> = {
  applied: ['onboarding', 'terminated'],
  onboarding: ['active', 'terminated'],
  active: ['suspended', 'terminated'],
  suspended: ['active', 'terminated'],
  terminated: [],
};
const STATUS_ACTION: Partial<Record<PartnerStatus, string>> = {
  onboarding: 'Start onboarding',
  active: 'Approve and activate',
  suspended: 'Suspend',
  terminated: 'End the partnership',
};

export function StatusControl({ id, status, missing }: { id: string; status: PartnerStatus; missing: string[] }) {
  const { busy, error, post } = usePost();
  const [to, setTo] = useState<PartnerStatus | null>(null);
  const [reason, setReason] = useState('');
  const options = NEXT_STATUSES[status];
  if (!options.length) return <p className="text-[12.5px] text-ink-500">{PARTNER_STATUS_LABEL[status]}. A new partnership starts with adding the partner again.</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {options.map((s) => (
          <Button key={s} size="sm" variant={s === 'active' ? 'primary' : s === 'terminated' ? 'danger' : 'secondary'} onClick={() => setTo(s)}>
            {STATUS_ACTION[s] ?? PARTNER_STATUS_LABEL[s]}
          </Button>
        ))}
      </div>
      {to === 'active' && missing.length > 0 && <p className="text-[12.5px] text-warn-700">Still needed: {missing.join(', ')}.</p>}
      {to && (
        <div className="space-y-2 rounded-lg bg-ink-50 p-3">
          <TextArea value={reason} onChange={setReason} rows={2} placeholder={to === 'active' ? 'e.g. Papers checked, agreement signed' : 'Why?'} />
          {error && <p className="text-[12px] text-bad-700">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || reason.trim().length < 5} onClick={async () => (await post(`/api/partners/${id}/status`, { status: to, reason: reason.trim() })) && setTo(null)}>
              {STATUS_ACTION[to] ?? 'Confirm'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setTo(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function TierControl({ id, tier, suggested }: { id: string; tier: PartnerTier; suggested: PartnerTier | null }) {
  const { busy, error, post } = usePost();
  const [to, setTo] = useState<string>(tier);
  const [reason, setReason] = useState(suggested && suggested !== tier ? `Results over the last 12 months reach ${PARTNER_TIER_LABEL[suggested]}` : '');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-40">
          <SelectInput value={to} onChange={setTo} options={PARTNER_TIERS.map((t) => ({ value: t, label: PARTNER_TIER_LABEL[t] }))} />
        </div>
        {suggested && suggested !== tier && (
          <button type="button" className="text-[12.5px] font-medium text-brand-700 hover:underline" onClick={() => setTo(suggested)}>
            Suggested: {PARTNER_TIER_LABEL[suggested]}
          </button>
        )}
      </div>
      {to !== tier && (
        <>
          <TextInput value={reason} onChange={setReason} placeholder="Why?" />
          {error && <p className="text-[12px] text-bad-700">{error}</p>}
          <Button size="sm" disabled={busy || reason.trim().length < 5} onClick={() => post(`/api/partners/${id}/tier`, { tier: to, reason: reason.trim() })}>
            Change tier
          </Button>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* People                                                               */
/* ------------------------------------------------------------------ */

export function AddMemberForm({ url, roles }: { url: string; roles: PartnerMemberRole[] }) {
  const { busy, error, fieldErrors, post } = usePost();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ fullName: '', email: '', phone: '', role: roles[roles.length - 1] ?? 'counsellor', password: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Add a login
      </Button>
    );
  }
  return (
    <div className="space-y-3 rounded-lg border border-line p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Full name" error={fieldErrors.fullName}>
          <TextInput value={f.fullName} onChange={set('fullName')} />
        </Field>
        <Field label="Email (their sign-in)" error={fieldErrors.email}>
          <TextInput type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Phone">
          <TextInput value={f.phone} onChange={set('phone')} />
        </Field>
        <Field label="Role">
          <SelectInput value={f.role} onChange={set('role')} options={roles.map((r) => ({ value: r, label: PARTNER_MEMBER_ROLE_LABEL[r] }))} />
        </Field>
        <Field label="First password" hint="Give it to them privately; they change it after signing in" error={fieldErrors.password}>
          <TextInput type="text" value={f.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
      </div>
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={async () => (await post(url, { ...f, phone: f.phone || null })) && (setOpen(false), setF({ fullName: '', email: '', phone: '', role: f.role, password: '' }))}>
          {busy ? 'Adding…' : 'Add'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function MemberActions({ url, member, roles }: { url: string; member: PartnerMemberView; roles: PartnerMemberRole[] }) {
  const { busy, error, post } = usePost();
  return (
    <span className="flex flex-wrap items-center gap-2">
      {roles.length > 1 && (
        <select
          value={member.role}
          disabled={busy}
          onChange={(e) => post(url, { role: e.target.value }, 'PUT')}
          className="h-8 rounded-md border border-line-strong bg-paper px-2 text-[12.5px]"
          aria-label="Role"
        >
          {[...new Set([member.role, ...roles])].map((r) => (
            <option key={r} value={r}>
              {PARTNER_MEMBER_ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      )}
      <Button size="sm" variant={member.active ? 'ghost' : 'secondary'} disabled={busy} onClick={() => post(url, { active: !member.active }, 'PUT')}>
        {member.active ? 'Switch login off' : 'Switch login on'}
      </Button>
      {error && <span className="text-[12px] text-bad-700">{error}</span>}
    </span>
  );
}

export function BankForm({ url, initial }: { url: string; initial: PartnerView['bank'] }) {
  const { busy, error, fieldErrors, post } = usePost();
  const [open, setOpen] = useState(!initial);
  const [f, setF] = useState({ accountTitle: initial?.accountTitle ?? '', bankName: initial?.bankName ?? '', iban: '', swift: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Change bank account
      </Button>
    );
  }
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Account title" error={fieldErrors.accountTitle}>
          <TextInput value={f.accountTitle} onChange={set('accountTitle')} />
        </Field>
        <Field label="Bank" error={fieldErrors.bankName}>
          <TextInput value={f.bankName} onChange={set('bankName')} />
        </Field>
        <Field label="IBAN or account number" error={fieldErrors.iban}>
          <TextInput value={f.iban} onChange={set('iban')} />
        </Field>
        <Field label="SWIFT (international)">
          <TextInput value={f.swift} onChange={set('swift')} />
        </Field>
      </div>
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={async () => (await post(url, { ...f, swift: f.swift || null }, 'PUT')) && setOpen(false)}>
          Save bank account
        </Button>
        {initial && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        )}
      </div>
      <p className="text-[11.5px] text-ink-400">Kept encrypted. A change is reported to whoever pays partners.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Papers                                                               */
/* ------------------------------------------------------------------ */

export function KycUploadForm({ url }: { url: string }) {
  const { busy, error, send } = usePost();
  const [kind, setKind] = useState<string>('registration');
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState(0);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-56">
        <Field label="Paper">
          <SelectInput value={kind} onChange={setKind} options={KYC_KINDS.map((k) => ({ value: k, label: KYC_KIND_LABEL[k] }))} />
        </Field>
      </div>
      <input key={key} type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[13px]" />
      <Button
        size="sm"
        disabled={busy || !file}
        onClick={async () => {
          const form = new FormData();
          form.append('kind', kind);
          form.append('file', file!);
          if (await send(url, form)) {
            setFile(null);
            setKey((k) => k + 1);
          }
        }}
      >
        {busy ? 'Uploading…' : 'Upload'}
      </Button>
      {error && <p className="w-full text-[12.5px] text-bad-700">{error}</p>}
    </div>
  );
}

export function KycReview({ partnerId, documentId }: { partnerId: string; documentId: string }) {
  const { busy, error, post } = usePost();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const url = `/api/partners/${partnerId}/documents/${documentId}/review`;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {rejecting ? (
        <>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is wrong with it" className="h-8 w-56 rounded-md border border-line-strong bg-paper px-2 text-[12.5px]" />
          <Button size="sm" variant="danger" disabled={busy || note.trim().length < 5} onClick={() => post(url, { decision: 'reject', note: note.trim() })}>
            Reject
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" disabled={busy} onClick={() => post(url, { decision: 'approve' })}>
            Approve
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRejecting(true)}>
            Reject…
          </Button>
        </>
      )}
      {error && <span className="text-[12px] text-bad-700">{error}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* The agreement                                                        */
/* ------------------------------------------------------------------ */

export function AgreementDraft({ partnerId, draft, initial }: { partnerId: string; draft: { title: string; body: string; validFrom: string } | null; initial: { id: string; title: string; body: string; validFrom: string; validTo: string | null } | null }) {
  const { busy, error, fieldErrors, post } = usePost();
  const [open, setOpen] = useState(Boolean(initial));
  const [f, setF] = useState({ title: initial?.title ?? draft?.title ?? '', body: initial?.body ?? draft?.body ?? '', validFrom: initial?.validFrom ?? draft?.validFrom ?? today(), validTo: initial?.validTo ?? '' });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Write the agreement
      </Button>
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_150px]">
        <Field label="Title" error={fieldErrors.title}>
          <TextInput value={f.title} onChange={set('title')} />
        </Field>
        <Field label="From">
          <TextInput type="date" value={f.validFrom} onChange={set('validFrom')} />
        </Field>
        <Field label="Until" hint="Optional">
          <TextInput type="date" value={f.validTo} onChange={set('validTo')} />
        </Field>
      </div>
      <Field label="Terms" hint="Plain text; a blank line starts a new paragraph. Frozen once sent." error={fieldErrors.body}>
        <TextArea value={f.body} onChange={set('body')} rows={16} />
      </Field>
      {error && <FormAlert>{error}</FormAlert>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => post(initial ? `/api/partners/${partnerId}/agreements/${initial.id}` : `/api/partners/${partnerId}/agreements`, { ...f, validTo: f.validTo || null }, initial ? 'PUT' : 'POST')}>
          Save draft
        </Button>
        {!initial && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Students                                                             */
/* ------------------------------------------------------------------ */

export function AssignPartner({ clientId, current, options }: { clientId: string; current: string | null; options: Option[] }) {
  const { busy, error, post } = usePost();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(current ?? '');
  const [reason, setReason] = useState('');
  if (!open) {
    return (
      <button type="button" className="text-[12.5px] font-medium text-brand-700 hover:underline" onClick={() => setOpen(true)}>
        Change
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-2">
      <SelectInput value={to} onChange={setTo} placeholder="The consultancy's own student" options={options.map((o) => ({ value: o.id, label: o.name }))} />
      <TextInput value={reason} onChange={setReason} placeholder="Why?" />
      {error && <p className="text-[12px] text-bad-700">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || reason.trim().length < 5} onClick={async () => (await post(`/api/partners/students/${clientId}`, { partnerId: to || null, reason: reason.trim() }, 'PUT')) && setOpen(false)}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function ConflictDecision({ id, currentName, claimantName }: { id: string; currentName: string; claimantName: string }) {
  const { busy, error, post } = usePost();
  const [note, setNote] = useState('');
  return (
    <div className="space-y-2">
      <TextInput value={note} onChange={setNote} placeholder="What decided it (e.g. who the student says referred them)" />
      {error && <p className="text-[12px] text-bad-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={busy || note.trim().length < 5} onClick={() => post(`/api/partners/conflicts/${id}/resolve`, { decision: 'keep', note: note.trim() })}>
          Keep with {currentName}
        </Button>
        <Button size="sm" disabled={busy || note.trim().length < 5} onClick={() => post(`/api/partners/conflicts/${id}/resolve`, { decision: 'transfer', note: note.trim() })}>
          Move to {claimantName}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Money                                                                */
/* ------------------------------------------------------------------ */

export function AdjustEarning({ partnerId, currency }: { partnerId: string; currency: string }) {
  const { busy, error, post } = usePost();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ amount: '', currency, reason: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Adjust
      </Button>
    );
  }
  return (
    <div className="w-full space-y-2 rounded-lg bg-ink-50 p-3">
      <div className="grid gap-2 sm:grid-cols-[140px_100px_minmax(0,1fr)]">
        <TextInput value={f.amount} onChange={set('amount')} inputMode="decimal" placeholder="Amount (- to take back)" />
        <SelectInput value={f.currency} onChange={set('currency')} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        <TextInput value={f.reason} onChange={set('reason')} placeholder="Why" />
      </div>
      {error && <p className="text-[12px] text-bad-700">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !Number(f.amount) || f.reason.trim().length < 5} onClick={async () => (await post(`/api/partners/${partnerId}/earnings/adjust`, { ...f, amount: Number(f.amount) })) && setOpen(false)}>
          Add the adjustment
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function CreatePayout({ partners, partnerId, currency, payoutsBase }: { partners: (Option & { currency: string })[]; partnerId: string | null; currency: string | null; payoutsBase: string }) {
  const { busy, error, post } = usePost();
  const [f, setF] = useState({ partnerId: partnerId ?? '', currency: currency ?? partners.find((p) => p.id === partnerId)?.currency ?? 'PKR', periodLabel: new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), through: '', advanceRecovery: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_100px_minmax(0,1fr)]">
        {!partnerId ? (
          <SelectInput value={f.partnerId} onChange={(v) => setF((x) => ({ ...x, partnerId: v, currency: partners.find((p) => p.id === v)?.currency ?? x.currency }))} placeholder="Partner…" options={partners.map((p) => ({ value: p.id, label: p.name }))} />
        ) : (
          <span className="flex items-center text-[13px] text-ink-700">{partners.find((p) => p.id === partnerId)?.name}</span>
        )}
        <SelectInput value={f.currency} onChange={set('currency')} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        <TextInput value={f.periodLabel} onChange={set('periodLabel')} placeholder="Period" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Owed up to" hint="Empty: everything owed today">
          <TextInput type="date" value={f.through} onChange={set('through')} />
        </Field>
        <Field label="Take back of an advance" hint="Empty: as much as possible">
          <TextInput value={f.advanceRecovery} onChange={set('advanceRecovery')} inputMode="decimal" />
        </Field>
      </div>
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
      <Button
        size="sm"
        disabled={busy || !f.partnerId || f.periodLabel.trim().length < 2}
        onClick={() =>
          post<{ id: string }>(
            '/api/partners/payouts',
            { partnerId: f.partnerId, currency: f.currency, periodLabel: f.periodLabel.trim(), through: f.through || null, advanceRecovery: f.advanceRecovery === '' ? null : Number(f.advanceRecovery) },
            'POST',
            (d) => `${payoutsBase}/${d.id}`,
          )
        }
      >
        Prepare the payout
      </Button>
    </div>
  );
}

export function PayPayout({ id, accounts, currency, baseCurrency }: { id: string; accounts: Option[]; currency: string; baseCurrency: string }) {
  const { busy, error, post } = usePost();
  const [f, setF] = useState({ paidOn: today(), accountId: accounts.find((a) => /bank/i.test(a.name))?.id ?? accounts[0]?.id ?? '', method: 'bank_transfer', reference: '', fxRate: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Paid on">
          <TextInput type="date" value={f.paidOn} onChange={set('paidOn')} />
        </Field>
        <Field label="From">
          <SelectInput value={f.accountId} onChange={set('accountId')} options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
        </Field>
        <Field label="How">
          <SelectInput value={f.method} onChange={set('method')} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))} />
        </Field>
        <Field label="Reference">
          <TextInput value={f.reference} onChange={set('reference')} />
        </Field>
        {currency !== baseCurrency && (
          <Field label={`Rate to ${baseCurrency}`}>
            <TextInput value={f.fxRate} onChange={set('fxRate')} inputMode="decimal" />
          </Field>
        )}
      </div>
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
      <Button size="sm" disabled={busy || !f.accountId} onClick={() => post(`/api/partners/payouts/${id}/pay`, { ...f, reference: f.reference || null, fxRate: f.fxRate ? Number(f.fxRate) : null })}>
        Record the payment
      </Button>
    </div>
  );
}

export function GiveAdvance({ partnerId, accounts, currency }: { partnerId: string; accounts: Option[]; currency: string }) {
  const { busy, error, post } = usePost();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ amount: '', currency, givenOn: today(), accountId: accounts.find((a) => /bank/i.test(a.name))?.id ?? accounts[0]?.id ?? '', reason: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Pay an advance
      </Button>
    );
  }
  return (
    <div className="w-full space-y-2 rounded-lg bg-ink-50 p-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <TextInput value={f.amount} onChange={set('amount')} inputMode="decimal" placeholder="Amount" />
        <SelectInput value={f.currency} onChange={set('currency')} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        <TextInput type="date" value={f.givenOn} onChange={set('givenOn')} />
        <SelectInput value={f.accountId} onChange={set('accountId')} options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
      </div>
      <TextInput value={f.reason} onChange={set('reason')} placeholder="What it is for" />
      {error && <p className="text-[12px] text-bad-700">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !(Number(f.amount) > 0) || f.reason.trim().length < 5} onClick={async () => (await post('/api/partners/advances', { ...f, partnerId, amount: Number(f.amount) })) && setOpen(false)}>
          Record the advance
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <p className="text-[11.5px] text-ink-400">Taken back from its next payouts.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rules                                                                */
/* ------------------------------------------------------------------ */

export function RuleEditor({ rule, partners, institutions }: { rule: PartnerRuleView | null; partners: Option[]; institutions: Option[] }) {
  const { busy, error, fieldErrors, post } = usePost();
  const [open, setOpen] = useState(false);
  const scope = rule?.partnerId ? 'partner' : rule?.tier ? 'tier' : 'all';
  const [f, setF] = useState({
    name: rule?.name ?? '',
    basis: rule?.basis ?? 'commission_share',
    ratePercent: String(rule?.ratePercent ?? ''),
    fixedAmount: String(rule?.fixedAmount ?? ''),
    currency: rule?.currency ?? 'PKR',
    scope,
    partnerId: rule?.partnerId ?? '',
    tier: rule?.tier ?? 'standard',
    institutionId: rule?.institutionId ?? '',
    feeCategories: (rule?.feeCategories ?? ['service']) as string[],
    validFrom: rule?.validFrom ?? today(),
    validTo: rule?.validTo ?? '',
    active: rule?.active ?? true,
  });
  const [conditions, setConditions] = useState<Condition[]>(rule?.conditions ?? []);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  if (!open) {
    return (
      <Button size="sm" variant={rule ? 'ghost' : 'primary'} onClick={() => setOpen(true)}>
        {rule ? 'Change' : 'Add a rule'}
      </Button>
    );
  }
  async function save() {
    const body = {
      name: f.name,
      basis: f.basis,
      ratePercent: Number(f.ratePercent) || 0,
      fixedAmount: Number(f.fixedAmount) || 0,
      currency: f.basis === 'fixed_per_student' ? f.currency : null,
      partnerId: f.scope === 'partner' ? f.partnerId || null : null,
      tier: f.scope === 'tier' ? f.tier : null,
      institutionId: f.basis !== 'fee_share' ? f.institutionId || null : null,
      feeCategories: f.feeCategories,
      conditions,
      validFrom: f.validFrom,
      validTo: f.validTo || null,
      active: f.active,
    };
    if (await post(rule ? `/api/partners/rules/${rule.ruleKey}` : '/api/partners/rules', body, rule ? 'PUT' : 'POST')) setOpen(false);
  }
  return (
    <div className="w-full space-y-3 rounded-lg border border-line bg-paper p-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Name" error={fieldErrors.name}>
          <TextInput value={f.name} onChange={set('name')} placeholder="e.g. Standard commission share" />
        </Field>
        <Field label="What it pays" hint={PARTNER_RULE_BASIS_HINT[f.basis as keyof typeof PARTNER_RULE_BASIS_HINT]}>
          <SelectInput value={f.basis} onChange={set('basis')} options={PARTNER_RULE_BASES.filter((b) => !rule || b === rule.basis).map((b) => ({ value: b, label: PARTNER_RULE_BASIS_LABEL[b] }))} />
        </Field>
        {f.basis === 'fixed_per_student' ? (
          <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-2">
            <Field label="Amount" error={fieldErrors.fixedAmount}>
              <TextInput value={f.fixedAmount} onChange={set('fixedAmount')} inputMode="decimal" />
            </Field>
            <Field label="Currency">
              <SelectInput value={f.currency} onChange={set('currency')} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
            </Field>
          </div>
        ) : (
          <Field label="Rate (%)" error={fieldErrors.ratePercent}>
            <TextInput value={f.ratePercent} onChange={set('ratePercent')} inputMode="decimal" />
          </Field>
        )}
        <Field label="For">
          <SelectInput
            value={f.scope}
            onChange={set('scope')}
            options={[
              { value: 'all', label: 'Every partner' },
              { value: 'tier', label: 'Partners of a tier' },
              { value: 'partner', label: 'One partner' },
            ]}
          />
        </Field>
        {f.scope === 'tier' && (
          <Field label="Tier">
            <SelectInput value={f.tier} onChange={set('tier')} options={PARTNER_TIERS.map((t) => ({ value: t, label: PARTNER_TIER_LABEL[t] }))} />
          </Field>
        )}
        {f.scope === 'partner' && (
          <Field label="Partner">
            <SelectInput value={f.partnerId} onChange={set('partnerId')} placeholder="Choose…" options={partners.map((p) => ({ value: p.id, label: p.name }))} />
          </Field>
        )}
        {f.basis !== 'fee_share' && (
          <Field label="Institution" hint="Optional: only students there">
            <SelectInput value={f.institutionId} onChange={set('institutionId')} placeholder="Any" options={institutions.map((i) => ({ value: i.id, label: i.name }))} />
          </Field>
        )}
        <Field label="From">
          <TextInput type="date" value={f.validFrom} onChange={set('validFrom')} />
        </Field>
        <Field label="Until" hint="Optional">
          <TextInput type="date" value={f.validTo} onChange={set('validTo')} />
        </Field>
      </div>
      {f.basis === 'fee_share' && (
        <div>
          <p className="mb-1 text-[13px] font-medium text-ink-700">On which fees</p>
          <div className="flex flex-wrap gap-3 text-[13px]">
            {SHAREABLE_FEE_CATEGORIES.map((c) => (
              <label key={c} className="flex items-center gap-1.5">
                <input type="checkbox" checked={f.feeCategories.includes(c)} onChange={(e) => setF((x) => ({ ...x, feeCategories: e.target.checked ? [...x.feeCategories, c] : x.feeCategories.filter((y) => y !== c) }))} />
                {FEE_CATEGORY_LABEL[c]}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[11.5px] text-ink-400">Never money passed through to universities or embassies, and always before tax.</p>
        </div>
      )}
      <div>
        <p className="mb-1 text-[13px] font-medium text-ink-700">Only when</p>
        <ConditionsEditor value={conditions} onChange={setConditions} fields={STAGE_CONDITION_FIELDS} empty="Every student." />
      </div>
      <label className="flex items-center gap-2 text-[13px] text-ink-700">
        <input type="checkbox" checked={f.active} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} /> In use
      </label>
      {rule && rule.earnings > 0 && <p className="text-[12px] text-ink-500">Something has been earned under it, so saving makes version {rule.version + 1}; those earnings keep these terms.</p>}
      {error && <FormAlert>{error}</FormAlert>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={save}>
          Save rule
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                             */
/* ------------------------------------------------------------------ */

export function PartnerSettingsForm({ settings }: { settings: PartnerSettingsView }) {
  const { busy, error, post } = usePost();
  const [f, setF] = useState({
    applicationsOpen: settings.applicationsOpen,
    attributionDays: String(settings.attributionDays),
    defaultWithholdingPercent: String(settings.defaultWithholdingPercent),
    requireSecondApprover: settings.requireSecondApprover,
    minimumPayout: String(settings.minimumPayout),
    silver: String(settings.tierThresholds.silver),
    gold: String(settings.tierThresholds.gold),
    platinum: String(settings.tierThresholds.platinum),
    agreementTemplate: settings.agreementTemplate,
  });
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="max-w-3xl space-y-4">
      <label className="flex items-center gap-2 text-[13.5px] text-ink-800">
        <input type="checkbox" checked={f.applicationsOpen} onChange={(e) => setF((x) => ({ ...x, applicationsOpen: e.target.checked }))} /> Take applications from the public "become a partner" page
      </label>
      <label className="flex items-center gap-2 text-[13.5px] text-ink-800">
        <input type="checkbox" checked={f.requireSecondApprover} onChange={(e) => setF((x) => ({ ...x, requireSecondApprover: e.target.checked }))} /> A payout is approved by someone other than whoever prepared it
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Attribution window (days)" hint="A student registered longer ago, with no live application, can be claimed again">
          <TextInput value={f.attributionDays} onChange={set('attributionDays')} inputMode="numeric" />
        </Field>
        <Field label="Tax withheld by default (%)">
          <TextInput value={f.defaultWithholdingPercent} onChange={set('defaultWithholdingPercent')} inputMode="decimal" />
        </Field>
        <Field label="Minimum payout" hint="In the partner's currency">
          <TextInput value={f.minimumPayout} onChange={set('minimumPayout')} inputMode="decimal" />
        </Field>
      </div>
      <div>
        <p className="mb-1 text-[13px] font-medium text-ink-700">Enrolled students in 12 months to reach each tier</p>
        <div className="grid grid-cols-3 gap-3">
          {(['silver', 'gold', 'platinum'] as const).map((t) => (
            <Field key={t} label={PARTNER_TIER_LABEL[t]}>
              <TextInput value={f[t]} onChange={set(t)} inputMode="numeric" />
            </Field>
          ))}
        </div>
      </div>
      <Field label="Agreement template" hint="{partner}, {consultancy} and {date} are filled in for each partner">
        <TextArea value={f.agreementTemplate} onChange={set('agreementTemplate')} rows={14} />
      </Field>
      {error && <FormAlert>{error}</FormAlert>}
      {saved && <FormAlert tone="ok">Saved.</FormAlert>}
      <Button
        disabled={busy}
        onClick={async () =>
          setSaved(
            Boolean(
              await post(
                '/api/partners/settings',
                {
                  applicationsOpen: f.applicationsOpen,
                  attributionDays: Number(f.attributionDays),
                  defaultWithholdingPercent: Number(f.defaultWithholdingPercent) || 0,
                  requireSecondApprover: f.requireSecondApprover,
                  minimumPayout: Number(f.minimumPayout) || 0,
                  tierThresholds: { silver: Number(f.silver), gold: Number(f.gold), platinum: Number(f.platinum) },
                  agreementTemplate: f.agreementTemplate,
                },
                'PUT',
              ),
            ),
          )
        }
      >
        Save settings
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Messages                                                             */
/* ------------------------------------------------------------------ */

export function MessageComposer({ url, students }: { url: string; students?: Option[] }) {
  const { busy, error, post } = usePost();
  const [body, setBody] = useState('');
  const [clientId, setClientId] = useState('');
  return (
    <div className="space-y-2">
      <TextArea value={body} onChange={setBody} rows={3} placeholder="Write a message…" />
      <div className="flex flex-wrap items-center gap-2">
        {students && students.length > 0 && (
          <div className="w-64">
            <SelectInput value={clientId} onChange={setClientId} placeholder="About no student in particular" options={students.map((s) => ({ value: s.id, label: s.name }))} />
          </div>
        )}
        <Button size="sm" disabled={busy || !body.trim()} onClick={async () => (await post(url, { body: body.trim(), clientId: clientId || null })) && (setBody(''), setClientId(''))}>
          Send
        </Button>
        {error && <span className="text-[12px] text-bad-700">{error}</span>}
      </div>
    </div>
  );
}

export function SwitchTabs({ tabs, active }: { tabs: { key: string; label: string; href: string; badge?: number }[]; active: string }) {
  return (
    <nav className="-mb-px mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} aria-current={active === t.key ? 'page' : undefined} className={cx('flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-[13.5px] font-medium', active === t.key ? 'border-brand-600 text-ink-950' : 'border-transparent text-ink-500 hover:text-ink-800')}>
          {t.label}
          {t.badge ? <span className="tnum rounded-full bg-warn-100 px-1.5 text-[11px] font-semibold text-warn-700">{t.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
