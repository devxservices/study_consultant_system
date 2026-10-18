'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { localIsoDate, CURRENCIES, formatMoney, parseMoney, type CommissionView, type InstitutionSummaryView } from '@crm/shared';
import { Button, cx } from '../ui';
import { callApi, Field, FormAlert, SelectInput, TextInput } from '../forms';
import { formatDate } from '@/lib/format';

const today = () => localIsoDate();

function usePost() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Sends it, then shows the result: the page it leads to when `then` names
   * one, else this page again. Navigating first and refreshing after - a
   * refresh started first can swallow the navigation.
   */
  async function post(url: string, json: unknown, method: 'POST' | 'PUT' = 'POST', then?: (data: { id?: string }) => string | null) {
    setBusy(true);
    setError(null);
    const res = await callApi<{ id?: string }>(url, { method, json });
    setBusy(false);
    if (!res.ok) {
      setError(res.message ?? Object.values(res.fieldErrors)[0] ?? 'That did not work.');
      return null;
    }
    const data = res.data ?? {};
    const next = then?.(data);
    if (next) router.push(next);
    router.refresh();
    return data;
  }
  return { busy, error, post, router };
}

/** The student enrolled: confirm it, with the day and (for another currency) the rate. */
export function ConfirmCommission({ id, currency, baseCurrency, amount }: { id: string; currency: string; baseCurrency: string; amount: number }) {
  const { busy, error, post } = usePost();
  const [enrolledOn, setEnrolledOn] = useState(today());
  const [fxRate, setFxRate] = useState('');
  const [confirmed, setConfirmed] = useState(String(amount / 100));
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Enrolled on">
          <TextInput type="date" value={enrolledOn} onChange={setEnrolledOn} />
        </Field>
        <Field label={`Amount (${currency})`} hint="If the institution confirmed a different figure">
          <TextInput value={confirmed} onChange={setConfirmed} inputMode="decimal" />
        </Field>
        {currency !== baseCurrency && (
          <Field label={`Rate to ${baseCurrency}`} hint="For reports">
            <TextInput value={fxRate} onChange={setFxRate} inputMode="decimal" />
          </Field>
        )}
      </div>
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
      <Button
        disabled={busy}
        onClick={() => {
          const changed = parseMoney(confirmed);
          post(`/api/commissions/${id}/confirm`, { enrolledOn, fxRate: fxRate ? Number(fxRate) : null, amount: changed && changed !== amount ? changed / 100 : null });
        }}
      >
        Confirm enrolment
      </Button>
      <p className="text-[12px] text-ink-400">Volume tiers are applied now, it is booked to the accounts, and a bonus is added if this student reaches the threshold.</p>
    </div>
  );
}

export function ClawbackForm({ id, currency, received }: { id: string; currency: string; received: number }) {
  const { busy, error, post } = usePost();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(received / 100));
  const [reason, setReason] = useState('');
  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Clawed back
      </Button>
    );
  }
  return (
    <div className="w-full space-y-2 rounded-lg bg-bad-50/60 p-3">
      <p className="text-[12.5px] text-ink-600">The institution took back commission it paid (the student left within the retention period). The income is reversed; the next payment from it can be matched net of this.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <TextInput value={amount} onChange={setAmount} inputMode="decimal" placeholder={`Amount (${currency})`} />
        <TextInput value={reason} onChange={setReason} placeholder="Why" />
      </div>
      {error && <p className="text-[12px] text-bad-700">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="danger" disabled={busy || reason.trim().length < 5} onClick={() => post(`/api/commissions/${id}/clawback`, { reason: reason.trim(), amount: Number(amount) || null })}>
          Record the clawback
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <p className="text-[11.5px] text-ink-400">Up to {formatMoney(received, currency)}.</p>
    </div>
  );
}

/** Who shares in it: the consultant who brought the student, a team lead... */
export function SplitsEditor({ id, splits, staff }: { id: string; splits: CommissionView['splits']; staff: { id: string; name: string }[] }) {
  const { busy, error, post } = usePost();
  const [rows, setRows] = useState(splits.map((s) => ({ userId: s.userId, share: String(s.shareBp / 100), paid: Boolean(s.paidOn) })));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SelectInput value={r.userId} onChange={(v) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, userId: v } : x)))} placeholder="Who" options={staff.map((s) => ({ value: s.id, label: s.name }))} />
          </div>
          <div className="w-24">
            <TextInput value={r.share} onChange={(v) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, share: v } : x)))} inputMode="decimal" />
          </div>
          <span className="text-[12.5px] text-ink-500">%</span>
          {!r.paid && (
            <button type="button" className="text-[12.5px] text-bad-700 hover:underline" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
              Remove
            </button>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => setRows((rs) => [...rs, { userId: '', share: '', paid: false }])}>
          Add a share
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => post(`/api/commissions/${id}/splits`, { splits: rows.filter((r) => r.userId && Number(r.share) > 0).map((r) => ({ userId: r.userId, sharePercent: Number(r.share) })) }, 'PUT')}>
          Save shares
        </Button>
      </div>
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
    </div>
  );
}

export function PayIncentive({ splitId, accounts }: { splitId: string; accounts: { id: string; name: string }[] }) {
  const { busy, error, post } = usePost();
  const [open, setOpen] = useState(false);
  const [paidOn, setPaidOn] = useState(today());
  const [accountId, setAccountId] = useState(accounts.find((a) => /bank/i.test(a.name))?.id ?? accounts[0]?.id ?? '');
  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Pay
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-36">
        <TextInput type="date" value={paidOn} onChange={setPaidOn} />
      </div>
      <div className="w-44">
        <SelectInput value={accountId} onChange={setAccountId} options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
      </div>
      <Button size="sm" disabled={busy} onClick={() => post(`/api/commissions/splits/${splitId}/pay`, { paidOn, accountId })}>
        Record payment
      </Button>
      {error && <span className="text-[12px] text-bad-700">{error}</span>}
    </div>
  );
}

/** Choose confirmed commissions for one institution and currency, and make the claim. */
export function NewClaimForm({ commissions, institutions, institutionId, detailBase }: { commissions: CommissionView[]; institutions: InstitutionSummaryView[]; institutionId: string; detailBase: string }) {
  const { busy, error, post, router } = usePost();
  // Before its claim window opens a commission is offered, but not ticked.
  const early = (c: CommissionView) => Boolean(c.claimableOn && c.claimableOn > today());
  const [chosen, setChosen] = useState<Set<string>>(new Set(commissions.filter((c) => !early(c)).map((c) => c.id)));
  const [period, setPeriod] = useState('');
  const currencies = [...new Set(commissions.filter((c) => chosen.has(c.id)).map((c) => c.currency))];
  const total = commissions.filter((c) => chosen.has(c.id)).reduce((n, c) => n + c.amount, 0);
  return (
    <div className="space-y-4">
      <Field label="Institution">
        <SelectInput value={institutionId} onChange={(v) => router.push(`?institutionId=${v}`)} placeholder="Choose…" options={institutions.map((i) => ({ value: i.id, label: i.name }))} />
      </Field>
      {institutionId && commissions.length === 0 && <p className="text-[13px] text-ink-500">Nothing confirmed and unclaimed with this institution.</p>}
      {commissions.length > 0 && (
        <div className="divide-y divide-line rounded-lg border border-line">
          {commissions.map((c) => (
            <label key={c.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <input type="checkbox" checked={chosen.has(c.id)} onChange={(e) => setChosen((s) => { const n = new Set(s); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })} />
              <span className="min-w-0 flex-1 text-ink-900">
                {c.kind === 'bonus' ? 'Volume bonus' : c.clientName}
                <span className="text-ink-400"> · {c.number}{c.intake ? ` · ${c.intake}` : ''}{c.kind === 'student' ? ` · year ${c.yearNo}` : ''}</span>
                {early(c) && <span className="block text-[11.5px] text-warn-700">Claimable from {formatDate(c.claimableOn)} - most institutions refuse earlier claims</span>}
              </span>
              <span className="tnum font-medium">{formatMoney(c.amount, c.currency)}</span>
            </label>
          ))}
        </div>
      )}
      <Field label="Period" hint="How the institution will recognise it">
        <TextInput value={period} onChange={setPeriod} placeholder="e.g. September 2026 intake" />
      </Field>
      {currencies.length > 1 && <p className="text-[12.5px] text-bad-700">A claim is in one currency; choose commissions in one.</p>}
      {error && <FormAlert>{error}</FormAlert>}
      <Button
        disabled={busy || chosen.size === 0 || currencies.length !== 1 || period.trim().length < 2}
        onClick={async () => {
          await post('/api/commissions/claims', { institutionId, commissionIds: [...chosen], periodLabel: period.trim() }, 'POST', (r) => (r.id ? `${detailBase}/${r.id}` : null));
        }}
      >
        Make the claim{chosen.size ? ` for ${formatMoney(total, currencies[0] ?? 'GBP')}` : ''}
      </Button>
    </div>
  );
}

export function SubmitClaim({ id }: { id: string }) {
  const { busy, error, post } = usePost();
  const [submittedOn, setSubmittedOn] = useState(today());
  const [dueOn, setDueOn] = useState('');
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Sent on">
          <TextInput type="date" value={submittedOn} onChange={setSubmittedOn} />
        </Field>
        <Field label="Due" hint="Empty: the agreement’s terms">
          <TextInput type="date" value={dueOn} onChange={setDueOn} />
        </Field>
      </div>
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
      <Button disabled={busy} onClick={() => post(`/api/commissions/claims/${id}/submit`, { submittedOn, dueOn: dueOn || null })}>
        Mark as sent
      </Button>
    </div>
  );
}

/** Money from an institution, matched to the commissions it pays (and deductions it makes). */
export function ReceiptForm({
  institutions,
  institutionId,
  claimId,
  open,
  accounts,
  baseCurrency,
  listBase,
}: {
  institutions: InstitutionSummaryView[];
  institutionId: string;
  claimId: string | null;
  open: CommissionView[];
  accounts: { id: string; name: string }[];
  baseCurrency: string;
  listBase: string;
}) {
  const { busy, error, post, router } = usePost();
  const inst = institutions.find((i) => i.id === institutionId);
  const [currency, setCurrency] = useState<string>(inst?.currency ?? baseCurrency);
  const [receivedOn, setReceivedOn] = useState(today());
  const [amount, setAmount] = useState('');
  const [charges, setCharges] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [accountId, setAccountId] = useState(accounts.find((a) => /bank/i.test(a.name))?.id ?? accounts[0]?.id ?? '');
  const [reference, setReference] = useState('');
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const candidates = open.filter((c) => c.currency === currency);
  const allocated = useMemo(() => Object.values(alloc).reduce((n, v) => n + (Number(v) || 0), 0), [alloc]);
  const gross = Number(amount) || 0;

  function autoMatch() {
    let left = gross;
    const next: Record<string, string> = {};
    for (const c of candidates) {
      if (c.status === 'clawed_back') continue;
      if (left <= 0) break;
      const take = Math.min(left, c.outstanding / 100);
      next[c.id] = String(Math.round(take * 100) / 100);
      left -= take;
    }
    setAlloc(next);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    await post(
      '/api/commissions/receipts',
      {
      institutionId,
      receivedOn,
      currency,
      amount: gross,
      bankCharges: Number(charges) || 0,
      fxRate: currency !== baseCurrency && fxRate ? Number(fxRate) : null,
      accountId,
      reference: reference || null,
      claimId,
      allocations: Object.entries(alloc)
        .filter(([, v]) => Number(v))
        .map(([commissionId, v]) => ({ commissionId, amount: Number(v) })),
      },
      'POST',
      () => listBase,
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="From">
          <SelectInput value={institutionId} onChange={(v) => router.push(`?institutionId=${v}`)} placeholder="Choose…" options={institutions.map((i) => ({ value: i.id, label: i.name }))} />
        </Field>
        <Field label="Received on">
          <TextInput type="date" value={receivedOn} onChange={setReceivedOn} />
        </Field>
        <Field label="Into">
          <SelectInput value={accountId} onChange={setAccountId} options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
        </Field>
        <Field label="Amount sent" hint="Before the bank’s charges">
          <TextInput value={amount} onChange={setAmount} inputMode="decimal" />
        </Field>
        <Field label="Bank charges" hint="Deducted on the way">
          <TextInput value={charges} onChange={setCharges} inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="Currency">
          <SelectInput value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        </Field>
        {currency !== baseCurrency && (
          <Field label={`Rate to ${baseCurrency}`} hint="On the day - for the exchange difference">
            <TextInput value={fxRate} onChange={setFxRate} inputMode="decimal" />
          </Field>
        )}
        <Field label="Their reference">
          <TextInput value={reference} onChange={setReference} />
        </Field>
      </div>
      {institutionId && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium text-ink-900">Match it to commissions</p>
            <Button type="button" size="sm" variant="ghost" onClick={autoMatch} disabled={!gross}>
              Match oldest first
            </Button>
          </div>
          {candidates.length === 0 ? (
            <p className="text-[12.5px] text-ink-400">Nothing outstanding in {currency} with this institution. It can still be recorded, unmatched.</p>
          ) : (
            <div className="divide-y divide-line rounded-lg border border-line">
              {candidates.map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1 text-ink-900">
                    {c.kind === 'bonus' ? 'Volume bonus' : c.clientName}
                    <span className="text-ink-400">
                      {' '}
                      · {c.number}
                      {c.claimNumber ? ` · ${c.claimNumber}` : ''}
                      {c.status === 'clawed_back' ? ' · clawed back: enter the deduction as a negative' : ` · ${formatMoney(c.outstanding, c.currency)} outstanding`}
                    </span>
                  </span>
                  <div className="w-28">
                    <TextInput value={alloc[c.id] ?? ''} onChange={(v) => setAlloc((a) => ({ ...a, [c.id]: v }))} inputMode="decimal" placeholder="0" />
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className={cx('tnum text-right text-[12.5px]', allocated > gross ? 'text-bad-700' : 'text-ink-500')}>
            Matched {allocated.toFixed(2)} of {gross.toFixed(2)} {currency}
            {gross - allocated > 0 && allocated > 0 ? ` · ${(gross - allocated).toFixed(2)} left as a credit with them` : ''}
          </p>
        </div>
      )}
      {error && <FormAlert>{error}</FormAlert>}
      <Button type="submit" disabled={busy || !institutionId || !gross || allocated > gross}>
        {busy ? 'Recording…' : 'Record the receipt'}
      </Button>
    </form>
  );
}

export function CommissionSettingsForm({ consultantSharePercent, followUpDays }: { consultantSharePercent: number; followUpDays: number }) {
  const { busy, error, post } = usePost();
  const [share, setShare] = useState(String(consultantSharePercent));
  const [days, setDays] = useState(String(followUpDays));
  const [saved, setSaved] = useState(false);
  return (
    <div className="max-w-md space-y-3">
      <Field label="The consultant’s share of each commission (%)" hint="Set on each new commission for the student’s consultant; can be changed per commission. 0 for none.">
        <TextInput value={share} onChange={setShare} inputMode="decimal" />
      </Field>
      <Field label="Chase overdue claims every (days)">
        <TextInput value={days} onChange={(v) => setDays(v.replace(/\D/g, ''))} inputMode="numeric" />
      </Field>
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
      {saved && <FormAlert tone="ok">Saved.</FormAlert>}
      <Button
        disabled={busy}
        onClick={async () => {
          const r = await post('/api/commissions/settings', { consultantSharePercent: Number(share) || 0, followUpDays: Number(days) || 14 }, 'PUT');
          setSaved(Boolean(r));
        }}
      >
        Save
      </Button>
    </div>
  );
}

/** An application's institution and fees - what its commission is worked out on. */
export function EnrolmentForm({
  caseId,
  institutions,
  initial,
}: {
  caseId: string;
  institutions: InstitutionSummaryView[];
  initial: { institutionId: string | null; tuitionFee: number | null; tuitionCurrency: string | null; scholarship: number | null; courseStart: string | null };
}) {
  const { busy, error, post } = usePost();
  const [open, setOpen] = useState(false);
  const [institutionId, setInstitutionId] = useState(initial.institutionId ?? '');
  const [tuition, setTuition] = useState(initial.tuitionFee ? String(initial.tuitionFee / 100) : '');
  const [currency, setCurrency] = useState(initial.tuitionCurrency ?? institutions.find((i) => i.id === initial.institutionId)?.currency ?? '');
  const [scholarship, setScholarship] = useState(initial.scholarship ? String(initial.scholarship / 100) : '');
  const [courseStart, setCourseStart] = useState(initial.courseStart ?? '');
  if (!open) {
    return (
      <button type="button" className="text-[12.5px] font-medium text-brand-700 hover:underline" onClick={() => setOpen(true)}>
        Edit
      </button>
    );
  }
  return (
    <div className="mt-3 space-y-2">
      <Field label="Institution">
        <SelectInput
          value={institutionId}
          onChange={(v) => {
            setInstitutionId(v);
            setCurrency(institutions.find((i) => i.id === v)?.currency ?? currency);
          }}
          placeholder="Not from the catalogue"
          options={institutions.map((i) => ({ value: i.id, label: `${i.name} (${i.country})` }))}
        />
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)_90px] gap-2">
        <Field label="First-year tuition">
          <TextInput value={tuition} onChange={setTuition} inputMode="decimal" />
        </Field>
        <Field label="Currency">
          <SelectInput value={currency} onChange={setCurrency} placeholder="-" options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Scholarship">
          <TextInput value={scholarship} onChange={setScholarship} inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="Course starts">
          <TextInput type="date" value={courseStart} onChange={setCourseStart} />
        </Field>
      </div>
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            const r = await post(
              `/api/cases/${caseId}/enrolment`,
              {
                institutionId: institutionId || null,
                tuitionFee: tuition ? parseMoney(tuition) : null,
                tuitionCurrency: tuition ? currency || null : null,
                scholarship: scholarship ? parseMoney(scholarship) : null,
                courseStart: courseStart || null,
              },
              'PUT',
            );
            if (r) setOpen(false);
          }}
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Commission the rules did not produce: an agreement not entered yet, a one-off bonus, a correction. */
export function ManualCommissionForm({
  institutions,
  caseId,
  caseLabel,
  institutionId: initialInstitution,
  detailBase,
}: {
  institutions: InstitutionSummaryView[];
  caseId: string | null;
  caseLabel: string | null;
  institutionId: string | null;
  detailBase: string;
}) {
  const { busy, error, post, router } = usePost();
  const [institutionId, setInstitutionId] = useState(initialInstitution ?? '');
  const [kind, setKind] = useState<'student' | 'bonus' | 'adjustment'>(caseId ? 'student' : 'bonus');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<string>(institutions.find((i) => i.id === initialInstitution)?.currency ?? 'GBP');
  const [yearNo, setYearNo] = useState('1');
  const [expectedOn, setExpectedOn] = useState('');
  const [note, setNote] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    await post(
      '/api/commissions',
      {
        caseId: kind === 'student' ? caseId : null,
        institutionId,
        kind,
        amount: Number(amount),
        currency,
        yearNo: Number(yearNo) || 1,
        expectedOn: expectedOn || null,
        note: note || null,
      },
      'POST',
      (r) => (r.id ? `${detailBase}/${r.id}` : null),
    );
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-xl space-y-3">
      {caseLabel && <p className="text-[13px] text-ink-600">For {caseLabel}.</p>}
      <Field label="Institution">
        <SelectInput
          value={institutionId}
          onChange={(v) => {
            setInstitutionId(v);
            setCurrency(institutions.find((i) => i.id === v)?.currency ?? currency);
          }}
          placeholder="Choose…"
          options={institutions.map((i) => ({ value: i.id, label: `${i.name} (${i.country})` }))}
        />
      </Field>
      <Field label="What it is">
        <SelectInput
          value={kind}
          onChange={(v) => setKind(v as typeof kind)}
          options={[
            ...(caseId ? [{ value: 'student', label: 'Commission on this student' }] : []),
            { value: 'bonus', label: 'A bonus from the institution' },
            { value: 'adjustment', label: 'An adjustment they agreed to' },
          ]}
        />
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)_100px_90px] gap-2">
        <Field label="Amount">
          <TextInput value={amount} onChange={setAmount} inputMode="decimal" />
        </Field>
        <Field label="Currency">
          <SelectInput value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label="Year">
          <TextInput value={yearNo} onChange={(v) => setYearNo(v.replace(/\D/g, ''))} inputMode="numeric" disabled={kind !== 'student'} />
        </Field>
      </div>
      <Field label="Expected to be paid by" hint="Optional - for the forecast">
        <TextInput type="date" value={expectedOn} onChange={setExpectedOn} />
      </Field>
      <Field label="Note">
        <TextInput value={note} onChange={setNote} placeholder="e.g. agreed by email on 3 March" />
      </Field>
      {error && <FormAlert>{error}</FormAlert>}
      <Button type="submit" disabled={busy || !institutionId || !(Number(amount) > 0)}>
        {busy ? 'Adding…' : 'Add as expected'}
      </Button>
      <p className="text-[12px] text-ink-400">It starts as expected; confirm it once the student enrols (or the institution agrees) to book it.</p>
    </form>
  );
}
