'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  localIsoDate,
  COMMISSION_YEARS,
  CURRENCIES,
  INSTITUTION_TYPES,
  INSTITUTION_TYPE_LABEL,
  STAGES,
  STAGE_CONDITION_FIELDS,
  STAGE_DEFINITIONS,
  type AgreementView,
  type CommissionRuleInput,
  type Condition,
  type InstitutionView,
} from '@crm/shared';
import { Button, Card, cx } from '../ui';
import { callApi, Field, FormAlert, SelectInput, TextArea, TextInput } from '../forms';
import { IconClose, IconPlus } from '../icons';
import { ConditionsEditor } from '../workflows/editors';

type Contact = { name: string; role: string; email: string; phone: string; primary: boolean };

/** An institution's profile and the people there. */
export function InstitutionForm({ initial, base, canEdit }: { initial: InstitutionView | null; base: string; canEdit: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({
    name: initial?.name ?? '',
    country: initial?.country ?? '',
    city: initial?.city ?? '',
    type: initial?.type ?? 'university',
    website: initial?.website ?? '',
    currency: initial?.currency ?? 'GBP',
    aggregator: initial?.aggregator ?? '',
    notes: initial?.notes ?? '',
    active: initial?.active ?? true,
  });
  const [contacts, setContacts] = useState<Contact[]>(
    initial?.contacts.map((c) => ({ name: c.name, role: c.role ?? '', email: c.email ?? '', phone: c.phone ?? '', primary: c.primary })) ?? [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    setSaved(false);
    const res = await callApi<InstitutionView>(initial ? `/api/institutions/${initial.id}` : '/api/institutions', {
      method: initial ? 'PUT' : 'POST',
      json: { ...f, city: f.city || null, website: f.website || null, aggregator: f.aggregator || null, notes: f.notes || null, contacts: contacts.filter((c) => c.name.trim()) },
    });
    setBusy(false);
    if (!res.ok || !res.data) {
      setErrors(res.fieldErrors);
      setError(res.message);
      return;
    }
    setSaved(true);
    if (!initial) router.push(`${base}/${res.data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate className="grid items-start gap-5 xl:grid-cols-2">
      <Card className="space-y-3 p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold text-ink-950">Profile</h2>
        {error && <FormAlert>{error}</FormAlert>}
        <Field label="Name" error={errors.name}>
          <TextInput value={f.name} onChange={set('name')} placeholder="e.g. University of Leeds" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Country" error={errors.country}>
            <TextInput value={f.country} onChange={set('country')} />
          </Field>
          <Field label="City">
            <TextInput value={f.city} onChange={set('city')} />
          </Field>
          <Field label="Type">
            <SelectInput value={f.type} onChange={(v) => set('type')(v as typeof f.type)} options={INSTITUTION_TYPES.map((t) => ({ value: t, label: INSTITUTION_TYPE_LABEL[t] }))} />
          </Field>
          <Field label="Pays commission in" error={errors.currency}>
            <SelectInput value={f.currency} onChange={(v) => set('currency')(v as typeof f.currency)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          </Field>
        </div>
        <Field label="Website">
          <TextInput value={f.website} onChange={set('website')} placeholder="https://" />
        </Field>
        <Field label="Through an aggregator" hint="When commission comes via ApplyBoard, Adventus and the like rather than directly">
          <TextInput value={f.aggregator} onChange={set('aggregator')} />
        </Field>
        <Field label="Notes">
          <TextArea value={f.notes} onChange={set('notes')} rows={3} />
        </Field>
        <label className="flex items-center gap-2 text-[13px] text-ink-700">
          <input type="checkbox" checked={f.active} onChange={(e) => set('active')(e.target.checked)} /> Offered on applications
        </label>
      </Card>
      <div className="space-y-5">
        <Card className="space-y-3 p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold text-ink-950">People</h2>
          {contacts.length === 0 && <p className="text-[12.5px] text-ink-400">Admissions, partnerships, finance - whoever you deal with.</p>}
          {contacts.map((c, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-2">
              <TextInput value={c.name} onChange={(v) => setContacts((cs) => cs.map((x, j) => (j === i ? { ...x, name: v } : x)))} placeholder="Name" />
              <TextInput value={c.role} onChange={(v) => setContacts((cs) => cs.map((x, j) => (j === i ? { ...x, role: v } : x)))} placeholder="Role" />
              <TextInput value={c.email} onChange={(v) => setContacts((cs) => cs.map((x, j) => (j === i ? { ...x, email: v } : x)))} placeholder="Email" />
              <TextInput value={c.phone} onChange={(v) => setContacts((cs) => cs.map((x, j) => (j === i ? { ...x, phone: v } : x)))} placeholder="Phone" />
              <div className="flex items-center justify-between sm:col-span-2">
                <label className="flex items-center gap-2 text-[12.5px] text-ink-600">
                  <input type="checkbox" checked={c.primary} onChange={(e) => setContacts((cs) => cs.map((x, j) => ({ ...x, primary: j === i ? e.target.checked : e.target.checked ? false : x.primary })))} /> Main contact
                </label>
                <button type="button" className="text-[12.5px] text-bad-700 hover:underline" onClick={() => setContacts((cs) => cs.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={() => setContacts((cs) => [...cs, { name: '', role: '', email: '', phone: '', primary: cs.length === 0 }])}>
            <IconPlus size={14} /> Add a person
          </Button>
        </Card>
        {saved && <FormAlert tone="ok">Saved.</FormAlert>}
        {canEdit && (
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : initial ? 'Save' : 'Add institution'}
          </Button>
        )}
      </div>
    </form>
  );
}

type RuleDraft = {
  name: string;
  basis: 'percent' | 'fixed';
  ratePercent: string;
  fixedAmount: string;
  years: 'first_year' | 'each_year';
  yearCount: string;
  tiers: { fromStudents: string; ratePercent: string }[];
  bonusStudents: string;
  bonusAmount: string;
  conditions: Condition[];
  retentionDays: string;
  triggerStage: string;
};

const blankRule = (): RuleDraft => ({
  name: '',
  basis: 'percent',
  ratePercent: '',
  fixedAmount: '',
  years: 'first_year',
  yearCount: '1',
  tiers: [],
  bonusStudents: '',
  bonusAmount: '',
  conditions: [],
  retentionDays: '0',
  triggerStage: 'fee_payment',
});

/** An agreement and its rules: what the institution pays, on whom, and when. */
export function AgreementForm({ institutionId, currency, initial, onDone }: { institutionId: string; currency: string; initial: AgreementView | null; onDone?: () => void }) {
  const router = useRouter();
  const today = localIsoDate();
  const [f, setF] = useState({
    title: initial?.title ?? '',
    reference: initial?.reference ?? '',
    validFrom: initial?.validFrom ?? today,
    validTo: initial?.validTo ?? '',
    currency: initial?.currency ?? currency,
    claimAfterDays: String(initial?.claimAfterDays ?? 30),
    paymentTermsDays: String(initial?.paymentTermsDays ?? 45),
    notes: initial?.notes ?? '',
    active: initial?.active ?? true,
  });
  const [rules, setRules] = useState<RuleDraft[]>(
    initial?.rules.map((r) => ({
      name: r.name,
      basis: r.basis,
      ratePercent: String(r.ratePercent),
      fixedAmount: String(r.fixedAmount),
      years: r.years,
      yearCount: String(r.yearCount),
      tiers: r.tiers.map((t) => ({ fromStudents: String(t.fromStudents), ratePercent: String(t.ratePercent) })),
      bonusStudents: r.bonusStudents === null ? '' : String(r.bonusStudents),
      bonusAmount: r.bonusAmount === null ? '' : String(r.bonusAmount),
      conditions: r.conditions,
      retentionDays: String(r.retentionDays),
      triggerStage: r.triggerStage,
    })) ?? [blankRule()],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setRule = (i: number, patch: Partial<RuleDraft>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      ...f,
      reference: f.reference || null,
      validTo: f.validTo || null,
      notes: f.notes || null,
      claimAfterDays: Number(f.claimAfterDays) || 0,
      paymentTermsDays: Number(f.paymentTermsDays) || 0,
      rules: rules.map(
        (r): CommissionRuleInput => ({
          name: r.name,
          basis: r.basis,
          ratePercent: Number(r.ratePercent) || 0,
          fixedAmount: Number(r.fixedAmount) || 0,
          years: r.years,
          yearCount: Number(r.yearCount) || 1,
          tiers: r.tiers.filter((t) => t.fromStudents && t.ratePercent).map((t) => ({ fromStudents: Number(t.fromStudents), ratePercent: Number(t.ratePercent) })),
          bonusStudents: r.bonusStudents ? Number(r.bonusStudents) : null,
          bonusAmount: r.bonusAmount ? Number(r.bonusAmount) : null,
          conditions: r.conditions,
          retentionDays: Number(r.retentionDays) || 0,
          triggerStage: r.triggerStage as CommissionRuleInput['triggerStage'],
        }),
      ),
    };
    const res = await callApi(initial ? `/api/institutions/${institutionId}/agreements/${initial.id}` : `/api/institutions/${institutionId}/agreements`, { method: initial ? 'PUT' : 'POST', json: payload });
    setBusy(false);
    if (!res.ok) {
      const first = Object.entries(res.fieldErrors)[0];
      setError(res.message ?? (first ? `${first[0]}: ${first[1]}` : 'Could not save.'));
      return;
    }
    onDone?.();
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {error && <FormAlert>{error}</FormAlert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title">
          <TextInput value={f.title} onChange={(v) => setF((x) => ({ ...x, title: v }))} placeholder="e.g. Agency agreement 2026-27" />
        </Field>
        <Field label="Their reference" hint="Optional">
          <TextInput value={f.reference} onChange={(v) => setF((x) => ({ ...x, reference: v }))} />
        </Field>
        <Field label="From">
          <TextInput type="date" value={f.validFrom} onChange={(v) => setF((x) => ({ ...x, validFrom: v }))} />
        </Field>
        <Field label="Until" hint="Empty: until ended">
          <TextInput type="date" value={f.validTo} onChange={(v) => setF((x) => ({ ...x, validTo: v }))} />
        </Field>
        <Field label="Currency">
          <SelectInput value={f.currency} onChange={(v) => setF((x) => ({ ...x, currency: v }))} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Claim after (days)" hint="From course start">
            <TextInput value={f.claimAfterDays} onChange={(v) => setF((x) => ({ ...x, claimAfterDays: v.replace(/\D/g, '') }))} inputMode="numeric" />
          </Field>
          <Field label="Pays within (days)" hint="Of a claim">
            <TextInput value={f.paymentTermsDays} onChange={(v) => setF((x) => ({ ...x, paymentTermsDays: v.replace(/\D/g, '') }))} inputMode="numeric" />
          </Field>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-[13px] font-medium text-ink-900">Rules - the first that matches an application applies</p>
        {rules.map((r, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-line p-3">
            <div className="flex items-center gap-2">
              <span className="tnum text-[12px] text-ink-400">{i + 1}.</span>
              <div className="flex-1">
                <TextInput value={r.name} onChange={(v) => setRule(i, { name: v })} placeholder="e.g. Postgraduate" />
              </div>
              {rules.length > 1 && (
                <button type="button" aria-label="Remove rule" className="text-ink-400 hover:text-bad-600" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>
                  <IconClose size={15} />
                </button>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <SelectInput value={r.basis} onChange={(v) => setRule(i, { basis: v as RuleDraft['basis'] })} options={[{ value: 'percent', label: '% of tuition' }, { value: 'fixed', label: 'Fixed amount' }]} />
              {r.basis === 'percent' ? (
                <TextInput value={r.ratePercent} onChange={(v) => setRule(i, { ratePercent: v })} inputMode="decimal" placeholder="Percent, e.g. 15" />
              ) : (
                <TextInput value={r.fixedAmount} onChange={(v) => setRule(i, { fixedAmount: v })} inputMode="decimal" placeholder={`Amount (${f.currency})`} />
              )}
              <SelectInput value={r.years} onChange={(v) => setRule(i, { years: v as RuleDraft['years'] })} options={COMMISSION_YEARS.map((y) => ({ value: y, label: y === 'first_year' ? 'First year only' : 'Every year' }))} />
              {r.years === 'each_year' && <TextInput value={r.yearCount} onChange={(v) => setRule(i, { yearCount: v.replace(/\D/g, '') })} inputMode="numeric" placeholder="Years" />}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Expected once the application reaches">
                <SelectInput value={r.triggerStage} onChange={(v) => setRule(i, { triggerStage: v })} options={STAGES.map((s) => ({ value: s, label: STAGE_DEFINITIONS[s].label }))} />
              </Field>
              <Field label="Clawed back if they leave within (days)">
                <TextInput value={r.retentionDays} onChange={(v) => setRule(i, { retentionDays: v.replace(/\D/g, '') })} inputMode="numeric" />
              </Field>
            </div>
            {r.basis === 'percent' && (
              <div className="space-y-1.5">
                <p className="text-[12px] text-ink-500">Volume tiers: a higher rate once enough students are confirmed under the agreement</p>
                {r.tiers.map((t, k) => (
                  <div key={k} className="flex items-center gap-2 text-[12.5px] text-ink-600">
                    From
                    <div className="w-20">
                      <TextInput value={t.fromStudents} onChange={(v) => setRule(i, { tiers: r.tiers.map((x, n) => (n === k ? { ...x, fromStudents: v.replace(/\D/g, '') } : x)) })} inputMode="numeric" />
                    </div>
                    students:
                    <div className="w-20">
                      <TextInput value={t.ratePercent} onChange={(v) => setRule(i, { tiers: r.tiers.map((x, n) => (n === k ? { ...x, ratePercent: v } : x)) })} inputMode="decimal" />
                    </div>
                    %
                    <button type="button" aria-label="Remove tier" className="text-ink-400 hover:text-bad-600" onClick={() => setRule(i, { tiers: r.tiers.filter((_, n) => n !== k) })}>
                      <IconClose size={13} />
                    </button>
                  </div>
                ))}
                <button type="button" className="text-[12.5px] font-medium text-brand-700" onClick={() => setRule(i, { tiers: [...r.tiers, { fromStudents: '', ratePercent: '' }] })}>
                  + Add a tier
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-600">
              Bonus of
              <div className="w-28">
                <TextInput value={r.bonusAmount} onChange={(v) => setRule(i, { bonusAmount: v })} inputMode="decimal" placeholder={f.currency} />
              </div>
              once
              <div className="w-20">
                <TextInput value={r.bonusStudents} onChange={(v) => setRule(i, { bonusStudents: v.replace(/\D/g, '') })} inputMode="numeric" />
              </div>
              students are confirmed (optional)
            </div>
            <div>
              <p className="mb-1.5 text-[12px] text-ink-500">Applies when</p>
              <ConditionsEditor value={r.conditions} onChange={(v) => setRule(i, { conditions: v })} fields={STAGE_CONDITION_FIELDS} empty="Every application with this institution." />
            </div>
          </div>
        ))}
        <Button type="button" variant="secondary" size="sm" onClick={() => setRules((rs) => [...rs, blankRule()])}>
          <IconPlus size={14} /> Add a rule
        </Button>
      </div>

      <Field label="Notes" hint="Anything the rules do not capture">
        <TextArea value={f.notes} onChange={(v) => setF((x) => ({ ...x, notes: v }))} rows={2} />
      </Field>
      <label className="flex items-center gap-2 text-[13px] text-ink-700">
        <input type="checkbox" checked={f.active} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} /> In force (untick to end it early)
      </label>
      {initial && <p className="text-[12px] text-ink-400">Changing the rules makes version {initial.version + 1}. Commissions already worked out keep the terms they were earned under.</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save agreement'}
        </Button>
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/** Opens the agreement form for a new or existing agreement. */
export function AgreementEditor({ institutionId, currency, agreement }: { institutionId: string; currency: string; agreement: AgreementView | null }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button size="sm" variant={agreement ? 'ghost' : 'primary'} onClick={() => setOpen(true)}>
        {agreement ? 'Edit' : 'Add an agreement'}
      </Button>
    );
  }
  return (
    <Card className={cx('mt-3 p-4', !agreement && 'w-full')}>
      <AgreementForm institutionId={institutionId} currency={currency} initial={agreement} onDone={() => setOpen(false)} />
    </Card>
  );
}

/** Attach the signed copy. */
export function AgreementDocument({ agreementId }: { agreementId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="inline-flex cursor-pointer items-center gap-1 text-[12.5px] font-medium text-brand-700 hover:underline">
      {busy ? 'Uploading…' : 'Attach the signed copy'}
      <input
        type="file"
        className="hidden"
        accept="application/pdf,image/*"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const form = new FormData();
          form.append('file', file);
          setBusy(true);
          const res = await callApi(`/api/institutions/agreements/${agreementId}/document`, { method: 'POST', form });
          setBusy(false);
          if (!res.ok) setError(res.message ?? 'Upload failed.');
          else router.refresh();
        }}
      />
      {error && <span className="text-bad-700">{error}</span>}
    </label>
  );
}
