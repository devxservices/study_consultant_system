'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CountryFee, CountryIntake, CountryView, LanguageRequirement } from '@crm/shared';
import { Button, Card, cx } from '../ui';
import { callApi, FormAlert } from '../forms';
import { IconClose, IconPlus } from '../icons';
import { AREA, INPUT } from './editors';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface State {
  name: string;
  code: string;
  currency: string;
  active: boolean;
  intakes: CountryIntake[];
  fees: CountryFee[];
  funds: { amount: string; currency: string; basis: string; holdingDays: string; notes: string };
  languageRequirements: LanguageRequirement[];
  visaTypes: string[];
  visaProcessingDays: string;
  workRights: string;
  postStudyWork: string;
  notes: string;
}

function from(c: CountryView | null, name?: string): State {
  return {
    name: c?.name ?? name ?? '',
    code: c?.code ?? '',
    currency: c?.currency ?? '',
    active: c?.active ?? true,
    intakes: c?.intakes ?? [],
    fees: c?.fees ?? [],
    funds: {
      amount: c?.proofOfFunds?.amount != null ? String(c.proofOfFunds.amount) : '',
      currency: c?.proofOfFunds?.currency ?? '',
      basis: c?.proofOfFunds?.basis ?? '',
      holdingDays: c?.proofOfFunds?.holdingDays != null ? String(c.proofOfFunds.holdingDays) : '',
      notes: c?.proofOfFunds?.notes ?? '',
    },
    languageRequirements: c?.languageRequirements ?? [],
    visaTypes: c?.visaTypes ?? [],
    visaProcessingDays: c?.visaProcessingDays != null ? String(c.visaProcessingDays) : '',
    workRights: c?.workRights ?? '',
    postStudyWork: c?.postStudyWork ?? '',
    notes: c?.notes ?? '',
  };
}

/**
 * One destination's facts - the ones counsellors are asked about daily.
 * Read by everyone on staff; edited by people who build workflows.
 */
export function CountryForm({ base, initial, suggestedName, canEdit }: { base: string; initial: CountryView | null; suggestedName?: string; canEdit: boolean }) {
  const router = useRouter();
  const [s, setS] = useState<State>(() => from(initial, suggestedName));
  const [visaDraft, setVisaDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof State>(k: K, v: State[K]) => setS((p) => ({ ...p, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const f = s.funds;
    const json = {
      name: s.name.trim(),
      code: s.code.trim(),
      currency: s.currency.trim(),
      active: s.active,
      intakes: s.intakes,
      fees: s.fees,
      proofOfFunds:
        f.amount || f.basis || f.holdingDays || f.notes
          ? {
              amount: f.amount ? Number(f.amount.replace(/,/g, '')) : null,
              currency: f.currency || s.currency || undefined,
              basis: f.basis || undefined,
              holdingDays: f.holdingDays ? Number(f.holdingDays) : null,
              notes: f.notes || undefined,
            }
          : null,
      languageRequirements: s.languageRequirements,
      visaTypes: s.visaTypes,
      visaProcessingDays: s.visaProcessingDays ? Number(s.visaProcessingDays) : null,
      workRights: s.workRights || undefined,
      postStudyWork: s.postStudyWork || undefined,
      notes: s.notes || undefined,
    };
    const res = initial
      ? await callApi(`/api/countries/${initial.id}`, { method: 'PUT', json })
      : await callApi<{ id: string }>('/api/countries', { method: 'POST', json });
    setBusy(false);
    if (!res.ok) {
      setFieldErrors(res.fieldErrors);
      setError(res.message ?? Object.entries(res.fieldErrors).map(([k, v]) => `${k}: ${v}`).join(' '));
      return;
    }
    router.push(`${base}/countries`);
    router.refresh();
  }

  const err = (k: string) => fieldErrors[k] && <span className="mt-1 block text-[12px] font-normal text-bad-700">{fieldErrors[k]}</span>;

  return (
    <fieldset disabled={!canEdit} className="max-w-4xl space-y-4">
      {error && <FormAlert>{error}</FormAlert>}

      <Card className="grid gap-3 p-4 sm:grid-cols-4 sm:p-5">
        <label className="block text-[13px] font-medium text-ink-700 sm:col-span-2">
          Country
          <input className={cx(INPUT, 'mt-1')} value={s.name} onChange={(e) => set('name', e.target.value)} placeholder="Canada" />
          {err('name')}
        </label>
        <label className="block text-[13px] font-medium text-ink-700">
          Code
          <input className={cx(INPUT, 'mt-1 uppercase')} value={s.code} maxLength={2} onChange={(e) => set('code', e.target.value)} placeholder="CA" />
          {err('code')}
        </label>
        <label className="block text-[13px] font-medium text-ink-700">
          Currency
          <input className={cx(INPUT, 'mt-1 uppercase')} value={s.currency} maxLength={3} onChange={(e) => set('currency', e.target.value)} placeholder="CAD" />
          {err('currency')}
        </label>
        <label className="flex items-center gap-2 text-[13px] text-ink-700 sm:col-span-4">
          <input type="checkbox" className="size-4 accent-brand-700" checked={s.active} onChange={(e) => set('active', e.target.checked)} />
          We send students here (unticked countries are hidden from the lists)
        </label>
      </Card>

      <Rows
        title="Intakes"
        empty="No intakes recorded."
        items={s.intakes}
        onChange={(v) => set('intakes', v)}
        add={(): CountryIntake => ({ name: '', month: 9 })}
        render={(it, up) => (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_minmax(0,1.4fr)]">
            <input aria-label="Intake" className={INPUT} value={it.name} placeholder="September" onChange={(e) => up({ ...it, name: e.target.value })} />
            <select aria-label="Month" className={INPUT} value={it.month} onChange={(e) => up({ ...it, month: Number(e.target.value) })}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  Starts {m}
                </option>
              ))}
            </select>
            <input aria-label="Deadline" className={INPUT} value={it.applicationDeadline ?? ''} placeholder="Deadlines, e.g. most close in March" onChange={(e) => up({ ...it, applicationDeadline: e.target.value || undefined })} />
          </div>
        )}
      />

      <Rows
        title="Government fees"
        empty="No fees recorded."
        items={s.fees}
        onChange={(v) => set('fees', v)}
        add={(): CountryFee => ({ label: '', amount: 0, currency: s.currency || 'USD' })}
        render={(f, up) => (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_90px_minmax(0,1fr)]">
            <input aria-label="Fee" className={INPUT} value={f.label} placeholder="Study permit" onChange={(e) => up({ ...f, label: e.target.value })} />
            <input aria-label="Amount" className={INPUT} inputMode="decimal" value={f.amount || ''} placeholder="Amount" onChange={(e) => up({ ...f, amount: Number(e.target.value) || 0 })} />
            <input aria-label="Currency" className={cx(INPUT, 'uppercase')} maxLength={3} value={f.currency} onChange={(e) => up({ ...f, currency: e.target.value.toUpperCase() })} />
            <input aria-label="Notes" className={INPUT} value={f.notes ?? ''} placeholder="Notes" onChange={(e) => up({ ...f, notes: e.target.value || undefined })} />
          </div>
        )}
      />

      <Card className="space-y-3 p-4 sm:p-5">
        <h2 className="text-[15px] font-medium text-ink-950">Proof of funds</h2>
        <div className="grid gap-2 sm:grid-cols-[140px_90px_minmax(0,1fr)_150px]">
          <input aria-label="Amount" className={INPUT} inputMode="decimal" value={s.funds.amount} placeholder="Amount" onChange={(e) => set('funds', { ...s.funds, amount: e.target.value })} />
          <input aria-label="Currency" className={cx(INPUT, 'uppercase')} maxLength={3} value={s.funds.currency} placeholder={s.currency || 'CUR'} onChange={(e) => set('funds', { ...s.funds, currency: e.target.value.toUpperCase() })} />
          <input aria-label="Basis" className={INPUT} value={s.funds.basis} placeholder="e.g. First-year tuition plus a year of living costs" onChange={(e) => set('funds', { ...s.funds, basis: e.target.value })} />
          <input aria-label="Held for" className={INPUT} inputMode="numeric" value={s.funds.holdingDays} placeholder="Held for (days)" onChange={(e) => set('funds', { ...s.funds, holdingDays: e.target.value })} />
        </div>
        <input aria-label="Funds notes" className={INPUT} value={s.funds.notes} placeholder="Notes" onChange={(e) => set('funds', { ...s.funds, notes: e.target.value })} />
      </Card>

      <Rows
        title="English and language tests"
        empty="No requirements recorded."
        items={s.languageRequirements}
        onChange={(v) => set('languageRequirements', v)}
        add={(): LanguageRequirement => ({ test: '', overall: '' })}
        render={(l, up) => (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_100px_120px_minmax(0,1fr)]">
            <input aria-label="Test" className={INPUT} value={l.test} placeholder="IELTS Academic" onChange={(e) => up({ ...l, test: e.target.value })} />
            <input aria-label="Overall" className={INPUT} value={l.overall} placeholder="Overall" onChange={(e) => up({ ...l, overall: e.target.value })} />
            <input aria-label="Lowest band" className={INPUT} value={l.minimumBand ?? ''} placeholder="No band below" onChange={(e) => up({ ...l, minimumBand: e.target.value || undefined })} />
            <input aria-label="Notes" className={INPUT} value={l.notes ?? ''} placeholder="Notes" onChange={(e) => up({ ...l, notes: e.target.value || undefined })} />
          </div>
        )}
      />

      <Card className="space-y-3 p-4 sm:p-5">
        <h2 className="text-[15px] font-medium text-ink-950">Visa</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {s.visaTypes.map((v) => (
            <button key={v} type="button" onClick={() => set('visaTypes', s.visaTypes.filter((x) => x !== v))} className="rounded-full bg-ink-100 px-2.5 py-1 text-[12.5px] text-ink-800 hover:bg-bad-50 hover:text-bad-700" title="Remove">
              {v} ×
            </button>
          ))}
          <input
            aria-label="Add a visa type"
            className={cx(INPUT, 'w-56')}
            value={visaDraft}
            placeholder="Add a visa type, press Enter"
            onChange={(e) => setVisaDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && visaDraft.trim()) {
                e.preventDefault();
                if (!s.visaTypes.includes(visaDraft.trim())) set('visaTypes', [...s.visaTypes, visaDraft.trim()]);
                setVisaDraft('');
              }
            }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
          <label className="block text-[13px] font-medium text-ink-700">
            Decision in about
            <span className="mt-1 flex items-center gap-2">
              <input className={cx(INPUT, 'w-24')} inputMode="numeric" value={s.visaProcessingDays} onChange={(e) => set('visaProcessingDays', e.target.value)} />
              <span className="text-[13px] font-normal text-ink-500">days</span>
            </span>
          </label>
          <label className="block text-[13px] font-medium text-ink-700">
            Work while studying
            <input className={cx(INPUT, 'mt-1')} value={s.workRights} onChange={(e) => set('workRights', e.target.value)} />
          </label>
          <label className="block text-[13px] font-medium text-ink-700 sm:col-span-2">
            After graduating
            <input className={cx(INPUT, 'mt-1')} value={s.postStudyWork} onChange={(e) => set('postStudyWork', e.target.value)} />
          </label>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <label className="block text-[15px] font-medium text-ink-950">
          Notes for counsellors
          <textarea className={cx(AREA, 'mt-2 text-[13.5px] font-normal')} rows={4} value={s.notes} onChange={(e) => set('notes', e.target.value)} placeholder="What changed recently, what to watch for, where to check." />
        </label>
      </Card>

      {canEdit && (
        <div className="flex gap-2">
          <Button onClick={save} disabled={busy || s.name.trim().length < 2}>
            {busy ? 'Saving…' : initial ? 'Save country' : 'Add country'}
          </Button>
          <Button variant="ghost" onClick={() => router.back()} disabled={busy}>
            Cancel
          </Button>
        </div>
      )}
    </fieldset>
  );
}

function Rows<T>({
  title,
  empty,
  items,
  onChange,
  add,
  render,
}: {
  title: string;
  empty: string;
  items: T[];
  onChange: (v: T[]) => void;
  add: () => T;
  render: (item: T, update: (v: T) => void) => React.ReactNode;
}) {
  return (
    <Card className="space-y-2 p-4 sm:p-5">
      <h2 className="text-[15px] font-medium text-ink-950">{title}</h2>
      {items.length === 0 && <p className="text-[12.5px] text-ink-400">{empty}</p>}
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">{render(it, (v) => onChange(items.map((x, j) => (j === i ? v : x))))}</div>
          <button type="button" className="rounded-md p-1.5 text-ink-400 hover:bg-bad-50 hover:text-bad-700" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <IconClose size={15} />
          </button>
        </div>
      ))}
      <Button size="sm" variant="ghost" className="-ml-2" onClick={() => onChange([...items, add()])}>
        <IconPlus size={15} />
        Add
      </Button>
    </Card>
  );
}
