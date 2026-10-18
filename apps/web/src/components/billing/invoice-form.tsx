'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CURRENCIES,
  FEE_CATEGORIES,
  FEE_CATEGORY_LABEL,
  bpToPercent,
  computeTotals,
  describePromo,
  formatMoney,
  parseMoney,
  splitInstallments,
  type FeeCategory,
  type InvoiceView,
  type PromoKind,
  type QuoteView,
  type ServicePackageView,
  type TaxRateView,
} from '@crm/shared';
import { Button, Card, cx } from '../ui';
import { callApi, Field, FormAlert, FormSection, SelectInput, TextArea, TextInput } from '../forms';
import { IconClose, IconPlus } from '../icons';

interface Line {
  description: string;
  packageId?: string;
  quantity: string;
  unit: string;
  discount: string;
  category: FeeCategory;
  taxRateId: string;
}

interface ClientOption {
  id: string;
  fullName: string;
  email: string;
}

interface Part {
  dueDate: string;
  amount: string;
}

const iso = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export interface BillFormProps {
  packages: ServicePackageView[];
  taxRates: TaxRateView[];
  baseCurrency: string;
  /** Discounts above this share wait for approval (when the issuer cannot approve). */
  approvalPercent: number | null;
  canApprove: boolean;
  initialClient?: ClientOption & { cases: { id: string; reference: string; label: string }[] };
  initialCaseId?: string;
  /** Where the new invoice or quote opens, e.g. /overview/finance/invoices */
  detailBase: string;
}

/** Issuing an invoice. */
export function InvoiceForm(props: BillFormProps) {
  return <BillForm {...props} mode="invoice" />;
}

/** Writing a quote or a proforma invoice. */
export function QuoteForm(props: BillFormProps) {
  return <BillForm {...props} mode="quote" />;
}

/**
 * The lines, discounts, promotion, tax and (for an invoice) the payment
 * schedule, with the totals worked out by the same calculation the server
 * uses - so what the form shows is what is issued, to the paisa.
 */
function BillForm({ packages, taxRates, baseCurrency, approvalPercent, canApprove, initialClient, initialCaseId, detailBase, mode }: BillFormProps & { mode: 'invoice' | 'quote' }) {
  const router = useRouter();
  const defaultTax = taxRates.find((t) => t.isDefault)?.id ?? '';
  const [client, setClient] = useState<ClientOption | null>(initialClient ?? null);
  const [cases, setCases] = useState(initialClient?.cases ?? []);
  const [caseId, setCaseId] = useState(initialCaseId ?? '');
  const [currency, setCurrency] = useState<string>(packages[0]?.currency ?? baseCurrency);
  const [issueDate, setIssueDate] = useState(iso(0));
  const [dueDate, setDueDate] = useState(iso(mode === 'quote' ? 30 : 14));
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState('');
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<{ code: string; kind: PromoKind; value: number } | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [discountReason, setDiscountReason] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [inParts, setInParts] = useState(false);
  const [partCount, setPartCount] = useState('3');
  const [parts, setParts] = useState<Part[]>([]);
  const [send, setSend] = useState(true);
  const [proforma, setProforma] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rateOf = (id: string) => taxRates.find((t) => t.id === id) ?? null;
  const totals = useMemo(
    () =>
      computeTotals(
        lines.map((l) => {
          const rate = rateOf(l.taxRateId);
          return {
            quantity: Math.max(1, Number(l.quantity) || 1),
            unitAmount: parseMoney(l.unit) ?? 0,
            discount: parseMoney(l.discount) ?? 0,
            tax: rate ? { rateBp: rate.rateBp, inclusive: rate.inclusive } : null,
          };
        }),
        promo,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, promo, taxRates],
  );
  const partsTotal = parts.reduce((n, p) => n + (parseMoney(p.amount) ?? 0), 0);
  const overLimit = approvalPercent !== null && totals.subtotal > 0 && (totals.discount * 100) / totals.subtotal > approvalPercent;

  function addPackage(id: string) {
    const p = packages.find((x) => x.id === id);
    if (!p) return;
    setCurrency(p.currency);
    setLines((ls) => [...ls, { description: p.name, packageId: p.id, quantity: '1', unit: String(p.amount / 100), discount: '', category: p.category, taxRateId: p.taxRateId ?? defaultTax }]);
  }

  function makeParts() {
    const n = Math.max(2, Math.min(24, Number(partCount) || 2));
    setParts(splitInstallments(totals.total, n, issueDate > iso(0) ? issueDate : iso(0)).map((p) => ({ dueDate: p.dueDate, amount: String(p.amount / 100) })));
  }

  async function applyPromo() {
    setPromoError(null);
    if (!promoInput.trim()) {
      setPromo(null);
      return;
    }
    const res = await callApi<{ code: string; kind: PromoKind; value: number }>(`/api/billing/promo/${encodeURIComponent(promoInput.trim())}?currency=${currency}`, { method: 'GET' });
    if (!res.ok || !res.data) {
      setPromo(null);
      setPromoError(res.fieldErrors.promoCode ?? res.message ?? 'That code is not valid.');
      return;
    }
    setPromo(res.data);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    if (!client) {
      setFormError(`Choose who the ${mode} is for.`);
      return;
    }
    const items = lines.map((l) => ({
      description: l.description.trim(),
      packageId: l.packageId,
      quantity: Math.max(1, Number(l.quantity) || 1),
      unitAmount: parseMoney(l.unit),
      discount: l.discount ? parseMoney(l.discount) : undefined,
      category: l.category,
      taxRateId: l.taxRateId || null,
    }));
    if (items.some((i) => i.unitAmount === null || (i.discount === null && i.discount !== undefined))) {
      setFormError('Every line needs an amount, like 75000 or 75000.50.');
      return;
    }
    const installments = mode === 'invoice' && inParts ? parts.map((p) => ({ dueDate: p.dueDate, amount: parseMoney(p.amount) ?? 0 })) : undefined;
    if (installments && installments.reduce((n, p) => n + p.amount, 0) !== totals.total) {
      setFormError(`The parts add up to ${formatMoney(partsTotal, currency)}, not ${formatMoney(totals.total, currency)}.`);
      return;
    }
    setBusy(true);
    const common = {
      clientId: client.id,
      caseId: caseId || undefined,
      currency,
      issueDate,
      items,
      promoCode: promo?.code ?? undefined,
      notes: notes.trim() || undefined,
    };
    const res =
      mode === 'invoice'
        ? await callApi<InvoiceView>('/api/billing/invoices', {
            method: 'POST',
            json: {
              ...common,
              dueDate,
              installments,
              discountReason: discountReason.trim() || undefined,
              fxRate: currency !== baseCurrency && fxRate ? Number(fxRate) : undefined,
              sendEmail: send,
            },
          })
        : await callApi<QuoteView>('/api/billing/quotes', { method: 'POST', json: { ...common, validUntil: dueDate, proforma, send } });
    setBusy(false);
    if (!res.ok || !res.data) {
      setErrors(res.fieldErrors);
      setFormError(res.message ?? Object.values(res.fieldErrors)[0] ?? null);
      return;
    }
    router.push(`${detailBase}/${res.data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-5">
        {formError && <FormAlert>{formError}</FormAlert>}

        <FormSection title="Bill to" description="The client, and the application it is for if it is for one.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client" required error={errors.clientId} className="sm:col-span-2">
              {client ? (
                <div className="flex h-10 items-center justify-between rounded-md border border-line-strong bg-ink-50 px-3">
                  <span className="truncate text-[14px] text-ink-900">
                    {client.fullName} <span className="text-ink-400">· {client.email}</span>
                  </span>
                  {!initialClient && (
                    <button
                      type="button"
                      onClick={() => {
                        setClient(null);
                        setCases([]);
                        setCaseId('');
                      }}
                      className="text-[12.5px] font-medium text-brand-700 hover:underline"
                    >
                      Change
                    </button>
                  )}
                </div>
              ) : (
                <ClientSearch
                  onPick={async (c) => {
                    setClient(c);
                    const res = await callApi<{ cases: { id: string; reference: string; targetProgram: string | null; targetUniversity: string | null; targetCountry: string }[] }>(`/api/clients/${c.id}`, { method: 'GET' });
                    setCases((res.data?.cases ?? []).map((k) => ({ id: k.id, reference: k.reference, label: `${k.reference} · ${k.targetProgram ?? k.targetUniversity ?? k.targetCountry}` })));
                  }}
                />
              )}
            </Field>
            <Field label="Application" hint="Optional" error={errors.caseId}>
              <SelectInput value={caseId} onChange={setCaseId} placeholder="Not for a specific application" options={cases.map((k) => ({ value: k.id, label: k.label }))} />
            </Field>
            <Field label="Currency">
              <SelectInput
                value={currency}
                onChange={(v) => {
                  setCurrency(v);
                  setPromo(null);
                }}
                options={CURRENCIES.map((c) => ({ value: c, label: c }))}
              />
            </Field>
            <Field label="Issue date" error={errors.issueDate}>
              <TextInput type="date" value={issueDate} onChange={setIssueDate} />
            </Field>
            <Field label={mode === 'invoice' ? 'Due date' : 'Valid until'} error={errors.dueDate ?? errors.validUntil} hint={mode === 'invoice' && inParts ? 'Set by the last part' : undefined}>
              <TextInput type="date" value={inParts && parts.length ? parts[parts.length - 1]!.dueDate : dueDate} onChange={setDueDate} disabled={mode === 'invoice' && inParts && parts.length > 0} />
            </Field>
            {currency !== baseCurrency && mode === 'invoice' && (
              <Field label={`Rate to ${baseCurrency}`} hint={`1 ${currency} = ? ${baseCurrency}. For reports in ${baseCurrency}; optional.`} error={errors.fxRate}>
                <TextInput value={fxRate} onChange={setFxRate} inputMode="decimal" placeholder="e.g. 355.20" />
              </Field>
            )}
          </div>
        </FormSection>

        <FormSection title="What it is for" description="From the fee catalogue or typed in. Each line’s kind decides where it is booked - money paid on the student’s behalf is never counted as income.">
          {lines.length > 0 && (
            <div className="mb-3 space-y-3">
              {lines.map((l, i) => {
                const r = totals.lines[i];
                const set = (patch: Partial<Line>) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <div key={i} className="rounded-lg border border-line p-3">
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px_32px]">
                      <TextInput value={l.description} onChange={(v) => set({ description: v })} placeholder="What for" invalid={Boolean(errors[`items.${i}.description`])} />
                      <SelectInput value={l.category} onChange={(v) => set({ category: v as FeeCategory })} options={FEE_CATEGORIES.filter((c) => c !== 'late_fee').map((c) => ({ value: c, label: FEE_CATEGORY_LABEL[c] }))} />
                      <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="flex h-10 items-center justify-center rounded-md text-ink-400 hover:bg-ink-50 hover:text-bad-600" aria-label="Remove line">
                        <IconClose size={16} />
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[70px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
                      <label className="text-[11.5px] text-ink-500">
                        Qty
                        <TextInput value={l.quantity} onChange={(v) => set({ quantity: v.replace(/\D/g, '') })} inputMode="numeric" />
                      </label>
                      <label className="text-[11.5px] text-ink-500">
                        Unit price
                        <TextInput value={l.unit} onChange={(v) => set({ unit: v })} inputMode="decimal" placeholder="0" invalid={parseMoney(l.unit) === null && l.unit !== ''} />
                      </label>
                      <label className="text-[11.5px] text-ink-500">
                        Discount
                        <TextInput value={l.discount} onChange={(v) => set({ discount: v })} inputMode="decimal" placeholder="0" invalid={parseMoney(l.discount) === null && l.discount !== ''} />
                      </label>
                      <label className="text-[11.5px] text-ink-500">
                        Tax
                        <SelectInput
                          value={l.taxRateId}
                          onChange={(v) => set({ taxRateId: v })}
                          placeholder="No tax"
                          options={taxRates.map((t) => ({ value: t.id, label: `${t.name} ${t.ratePercent}%${t.inclusive ? ' incl.' : ''}` }))}
                        />
                      </label>
                      <div className="text-right text-[11.5px] text-ink-500">
                        Line total
                        <p className="tnum flex h-10 items-center justify-end text-[14px] font-medium text-ink-900">{formatMoney(r?.total ?? 0, currency)}</p>
                      </div>
                    </div>
                    {r && (r.discount > 0 || r.tax > 0) && (
                      <p className="mt-1 text-right text-[11.5px] text-ink-400">
                        {r.discount > 0 && `${formatMoney(r.discount, currency)} off`}
                        {r.discount > 0 && r.tax > 0 && ' · '}
                        {r.tax > 0 && `${formatMoney(r.tax, currency)} tax${rateOf(l.taxRateId)?.inclusive ? ' included' : ''}`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {packages.length > 0 && (
              <div className="w-72">
                <SelectInput
                  value=""
                  onChange={addPackage}
                  placeholder="Add from the fee catalogue…"
                  options={packages.map((p) => ({ value: p.id, label: `${p.name} — ${formatMoney(p.amount, p.currency)}` }))}
                />
              </div>
            )}
            <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, { description: '', quantity: '1', unit: '', discount: '', category: 'service', taxRateId: defaultTax }])}>
              <IconPlus size={15} />
              Custom charge
            </Button>
          </div>
          {errors.items && <p className="mt-2 text-[12px] text-bad-700">{errors.items}</p>}
        </FormSection>

        <FormSection title="Promotion" description="A code from your promotions list, applied across the lines.">
          <div className="flex flex-wrap items-start gap-2">
            <div className="w-56">
              <TextInput value={promoInput} onChange={(v) => setPromoInput(v.toUpperCase())} placeholder="e.g. WELCOME10" invalid={Boolean(promoError || errors.promoCode)} />
            </div>
            <Button type="button" variant="secondary" onClick={applyPromo}>
              {promo ? 'Re-check' : 'Apply'}
            </Button>
            {promo && (
              <span className="flex h-10 items-center gap-2 text-[13px] text-ok-700">
                {promo.code}: {describePromo({ kind: promo.kind, value: promo.value, currency: currency as never })}
                <button type="button" className="text-ink-400 hover:text-bad-600" onClick={() => { setPromo(null); setPromoInput(''); }} aria-label="Remove the promotion">
                  <IconClose size={14} />
                </button>
              </span>
            )}
          </div>
          {(promoError || errors.promoCode) && <p className="mt-1.5 text-[12px] text-bad-700">{promoError ?? errors.promoCode}</p>}
          {totals.discount > 0 && mode === 'invoice' && (
            <div className="mt-4">
              <Field
                label="Why the discount"
                error={errors.discountReason}
                hint={overLimit && !canApprove ? `Over your consultancy’s ${approvalPercent}% limit, so it goes to someone with approval rights first.` : 'Kept with the invoice for whoever reviews it.'}
              >
                <TextInput value={discountReason} onChange={setDiscountReason} placeholder="e.g. Sibling of an existing student" invalid={Boolean(errors.discountReason)} />
              </Field>
            </div>
          )}
        </FormSection>

        {mode === 'invoice' && (
          <FormSection title="Payment schedule" description="Let the student pay in parts. Each part gets its own reminders, and late fees apply part by part.">
            <label className="flex items-center gap-2 text-[13.5px] text-ink-800">
              <input
                type="checkbox"
                checked={inParts}
                onChange={(e) => {
                  setInParts(e.target.checked);
                  if (e.target.checked && !parts.length) makeParts();
                }}
              />
              Pay in installments
            </label>
            {inParts && (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="w-28 text-[11.5px] text-ink-500">
                    Parts
                    <TextInput value={partCount} onChange={(v) => setPartCount(v.replace(/\D/g, ''))} inputMode="numeric" />
                  </label>
                  <Button type="button" variant="secondary" onClick={makeParts}>
                    Split evenly, monthly
                  </Button>
                </div>
                {parts.map((p, i) => (
                  <div key={i} className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_32px] items-center gap-2">
                    <span className="tnum text-[12.5px] text-ink-400">{i + 1}.</span>
                    <TextInput type="date" value={p.dueDate} onChange={(v) => setParts((ps) => ps.map((x, j) => (j === i ? { ...x, dueDate: v } : x)))} />
                    <TextInput value={p.amount} onChange={(v) => setParts((ps) => ps.map((x, j) => (j === i ? { ...x, amount: v } : x)))} inputMode="decimal" />
                    <button type="button" className="flex h-10 items-center justify-center text-ink-400 hover:text-bad-600" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))} aria-label="Remove part">
                      <IconClose size={14} />
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setParts((ps) => [...ps, { dueDate: ps[ps.length - 1]?.dueDate ?? iso(30), amount: '' }])}>
                    <IconPlus size={14} />
                    Add a part
                  </Button>
                  <p className={cx('tnum text-[12.5px]', partsTotal === totals.total ? 'text-ok-700' : 'text-bad-700')}>
                    {formatMoney(partsTotal, currency)} of {formatMoney(totals.total, currency)}
                  </p>
                </div>
                {errors.installments && <p className="text-[12px] text-bad-700">{errors.installments}</p>}
              </div>
            )}
          </FormSection>
        )}

        <FormSection title="Note to the client" description="Printed on the document. Your bank details are added from the finance settings.">
          <TextArea value={notes} onChange={setNotes} rows={3} placeholder="e.g. Please quote the invoice number with your transfer." />
        </FormSection>
      </div>

      <Card className="sticky top-20 p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold text-ink-950">Summary</h2>
        <dl className="mt-4 space-y-2 text-[13.5px]">
          <div className="flex justify-between">
            <dt className="text-ink-500">Subtotal</dt>
            <dd className="tnum text-ink-800">{formatMoney(totals.subtotal, currency)}</dd>
          </div>
          {totals.discount > 0 && (
            <div className="flex justify-between">
              <dt className="text-ink-500">Discounts</dt>
              <dd className="tnum text-ink-800">−{formatMoney(totals.discount, currency)}</dd>
            </div>
          )}
          {totals.tax > 0 && (
            <div className="flex justify-between">
              <dt className="text-ink-500">Tax</dt>
              <dd className="tnum text-ink-800">{formatMoney(totals.tax, currency)}</dd>
            </div>
          )}
          {mode === 'invoice' && inParts && parts.length > 0 && (
            <div className="flex justify-between">
              <dt className="text-ink-500">In parts</dt>
              <dd className="tnum text-ink-800">{parts.length}</dd>
            </div>
          )}
        </dl>
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-[12.5px] text-ink-500">Total</p>
          <p className="tnum text-[28px] font-semibold leading-9 text-ink-950">{formatMoney(totals.total, currency)}</p>
        </div>
        {overLimit && !canApprove && mode === 'invoice' && (
          <p className="mt-3 rounded-lg bg-warn-50 px-3 py-2 text-[12.5px] text-warn-700">
            The discount is {bpToPercent(Math.round((totals.discount * 10_000) / Math.max(1, totals.subtotal)))}%, over the {approvalPercent}% limit. It will wait for approval before the student sees it.
          </p>
        )}
        {mode === 'quote' && (
          <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-700">
            <input type="checkbox" checked={proforma} onChange={(e) => setProforma(e.target.checked)} />
            Proforma invoice (for a bank or an embassy)
          </label>
        )}
        <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-700">
          <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} />
          {mode === 'invoice' ? 'Email it to the student with the PDF' : 'Send it to the student now'}
        </label>
        <Button type="submit" className="mt-4 w-full" disabled={busy || lines.length === 0 || !client}>
          {busy ? 'Saving…' : mode === 'invoice' ? (overLimit && !canApprove ? 'Send for approval' : 'Issue invoice') : send ? 'Send quote' : 'Save draft'}
        </Button>
        <p className="mt-2 text-[12px] text-ink-400">
          {mode === 'invoice'
            ? 'Once issued, its lines and total are fixed. Mistakes are put right with a credit note or by voiding it.'
            : 'The student can accept or decline it in their portal; accepted quotes become invoices at these prices.'}
        </p>
      </Card>
    </form>
  );
}

/** Type-ahead over the clients this person can see. */
function ClientSearch({ onPick }: { onPick: (c: ClientOption) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ClientOption[]>([]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await callApi<{ items: ClientOption[] }>(`/api/clients?pageSize=8&q=${encodeURIComponent(q.trim())}`, { method: 'GET' });
      setResults(res.data?.items ?? []);
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="relative">
      <TextInput value={q} onChange={setQ} placeholder="Search by name, email or phone" />
      {results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-line bg-paper shadow-raise">
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(c);
                  setQ('');
                  setResults([]);
                }}
                className="block w-full px-3 py-2 text-left text-[13.5px] hover:bg-ink-50"
              >
                <span className="font-medium text-ink-900">{c.fullName}</span>
                <span className="text-ink-400"> · {c.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
