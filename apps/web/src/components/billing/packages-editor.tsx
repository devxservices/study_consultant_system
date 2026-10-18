'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { CURRENCIES, FEE_CATEGORIES, FEE_CATEGORY_LABEL, formatMoney, parseMoney, type FeeCategory, type ServicePackageView, type TaxRateView } from '@crm/shared';
import { Button, Card, Pill } from '../ui';
import { callApi, Field, FormAlert, SelectInput, TextArea, TextInput } from '../forms';

/**
 * The consultancy's price list. Changing a price here changes what the next
 * invoice suggests - never an invoice already issued, whose lines are fixed.
 */
export function PackagesEditor({ packages, taxRates = [] }: { packages: ServicePackageView[]; taxRates?: TaxRateView[] }) {
  const [editing, setEditing] = useState<string | 'new' | null>(packages.length ? null : 'new');

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
      <Card className="overflow-hidden">
        {packages.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-ink-400">No packages yet. Add your first on the right.</p>
        ) : (
          <ul className="divide-y divide-line">
            {packages.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[14.5px] font-semibold text-ink-950">
                    {p.name}
                    {!p.active && <Pill tone="neutral">Hidden</Pill>}
                  </p>
                  {p.description && <p className="mt-0.5 text-[13px] text-ink-500">{p.description}</p>}
                  <p className="mt-0.5 text-[12px] text-ink-400">
                    {FEE_CATEGORY_LABEL[p.category]}
                    {p.taxRateId ? ` · ${taxRates.find((t) => t.id === p.taxRateId)?.name ?? 'tax'}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="tnum text-[15px] font-semibold text-ink-950">{formatMoney(p.amount, p.currency)}</span>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(p.id)}>
                    Edit
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4 sm:p-5">
        {editing ? (
          <PackageForm
            key={editing}
            initial={editing === 'new' ? null : (packages.find((p) => p.id === editing) ?? null)}
            taxRates={taxRates}
            onDone={() => setEditing(null)}
          />
        ) : (
          <div>
            <h2 className="text-[15px] font-semibold text-ink-950">Fee catalogue</h2>
            <p className="mt-1 text-[13px] text-ink-500">
              What you charge, as it appears on invoices. Pick a package to edit it, or add a new one.
            </p>
            <Button className="mt-4" onClick={() => setEditing('new')}>
              Add a package
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function PackageForm({ initial, onDone, taxRates }: { initial: ServicePackageView | null; onDone: () => void; taxRates: TaxRateView[] }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [amount, setAmount] = useState(initial ? String(initial.amount / 100) : '');
  const [currency, setCurrency] = useState<string>(initial?.currency ?? 'PKR');
  const [active, setActive] = useState(initial?.active ?? true);
  const [category, setCategory] = useState<FeeCategory>(initial?.category ?? 'service');
  const [taxRateId, setTaxRateId] = useState(initial?.taxRateId ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const minor = parseMoney(amount);
    if (minor === null) {
      setErrors({ amount: 'Enter a price, like 75000' });
      return;
    }
    setBusy(true);
    const res = await callApi(initial ? `/api/billing/packages/${initial.id}` : '/api/billing/packages', {
      method: initial ? 'PATCH' : 'POST',
      json: { name: name.trim(), description: description.trim() || null, amount: minor, currency, active, category, taxRateId: taxRateId || null },
    });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors);
      setError(res.message);
      return;
    }
    onDone();
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <h2 className="text-[15px] font-semibold text-ink-950">{initial ? 'Edit package' : 'New package'}</h2>
      {error && <FormAlert>{error}</FormAlert>}
      <Field label="Name" required error={errors.name}>
        <TextInput value={name} onChange={setName} placeholder="e.g. Admission processing" invalid={Boolean(errors.name)} />
      </Field>
      <Field label="What it includes" error={errors.description}>
        <TextArea value={description} onChange={setDescription} rows={2} />
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
        <Field label="Price" required error={errors.amount}>
          <TextInput value={amount} onChange={setAmount} inputMode="decimal" placeholder="75000" invalid={Boolean(errors.amount)} />
        </Field>
        <Field label="Currency">
          <SelectInput value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        </Field>
      </div>
      <Field label="Kind of fee" hint="Decides where it is booked. Fees paid on a student’s behalf are never income.">
        <SelectInput value={category} onChange={(v) => setCategory(v as FeeCategory)} options={FEE_CATEGORIES.filter((c) => c !== 'late_fee').map((c) => ({ value: c, label: FEE_CATEGORY_LABEL[c] }))} />
      </Field>
      <Field label="Tax" hint="Added to new invoice lines for it; can be changed on the line.">
        <SelectInput value={taxRateId} onChange={setTaxRateId} placeholder="No tax" options={taxRates.filter((t) => t.active).map((t) => ({ value: t.id, label: `${t.name} ${t.ratePercent}%${t.inclusive ? ' (included)' : ''}` }))} />
      </Field>
      <label className="flex items-center gap-2 text-[13.5px] text-ink-700">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-brand-700" />
        Offer it on new invoices
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
