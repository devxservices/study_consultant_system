'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { localIsoDate, CURRENCIES, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, parseMoney } from '@crm/shared';
import { Button } from '../ui';
import { callApi, Field, FormAlert, SelectInput, TextInput } from '../forms';
import { Modal } from '../modal';

const today = () => localIsoDate();

export interface Option {
  id: string;
  name: string;
}

/** Money spent there and then, with the receipt if there is one. */
export function ExpenseButton({ headings, moneyAccounts, baseCurrency, startOpen = false }: { headings: Option[]; moneyAccounts: Option[]; baseCurrency: string; startOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [f, setF] = useState({ spentOn: today(), accountId: '', vendor: '', description: '', amount: '', taxAmount: '', currency: baseCurrency, fxRate: '', paidFromAccountId: moneyAccounts[0]?.id ?? '', method: 'bank_transfer', reference: '' });
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const amount = parseMoney(f.amount);
    const tax = f.taxAmount ? parseMoney(f.taxAmount) : 0;
    if (!amount || tax === null) {
      setErrors({ amount: amount ? '' : 'Enter the amount', taxAmount: tax === null ? 'Enter a number' : '' });
      return;
    }
    const form = new FormData();
    const fields: Record<string, string> = { ...f, amount: String(amount), taxAmount: String(tax ?? 0) };
    if (f.currency === baseCurrency || !f.fxRate) delete fields.fxRate;
    if (!f.reference) delete fields.reference;
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    if (file) form.append('file', file);
    setBusy(true);
    setErrors({});
    setError(null);
    const res = await callApi('/api/finance/expenses', { method: 'POST', form });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors);
      setError(res.message);
      return;
    }
    setOpen(false);
    setF((x) => ({ ...x, vendor: '', description: '', amount: '', taxAmount: '', reference: '' }));
    setFile(null);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Record expense</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Record an expense" description="Money already paid out. A fee paid on a student’s behalf goes under Disbursements, to be invoiced back." wide>
        <form onSubmit={submit} noValidate className="space-y-3">
          {error && <FormAlert>{error}</FormAlert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="What for" error={errors.accountId}>
              <SelectInput value={f.accountId} onChange={set('accountId')} placeholder="Choose a heading" options={headings.map((h) => ({ value: h.id, label: h.name }))} />
            </Field>
            <Field label="Date" error={errors.spentOn}>
              <TextInput type="date" value={f.spentOn} onChange={set('spentOn')} />
            </Field>
            <Field label="Paid to" error={errors.vendor}>
              <TextInput value={f.vendor} onChange={set('vendor')} placeholder="e.g. K-Electric" />
            </Field>
            <Field label="Description" error={errors.description}>
              <TextInput value={f.description} onChange={set('description')} placeholder="e.g. Office electricity, October" />
            </Field>
            <Field label="Amount" error={errors.amount}>
              <TextInput value={f.amount} onChange={set('amount')} inputMode="decimal" />
            </Field>
            <Field label="Of which reclaimable tax" hint="Optional" error={errors.taxAmount}>
              <TextInput value={f.taxAmount} onChange={set('taxAmount')} inputMode="decimal" placeholder="0" />
            </Field>
            <Field label="Currency">
              <SelectInput value={f.currency} onChange={set('currency')} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
            </Field>
            {f.currency !== baseCurrency && (
              <Field label={`Rate to ${baseCurrency}`} hint="Optional">
                <TextInput value={f.fxRate} onChange={set('fxRate')} inputMode="decimal" />
              </Field>
            )}
            <Field label="Paid from" error={errors.paidFromAccountId}>
              <SelectInput value={f.paidFromAccountId} onChange={set('paidFromAccountId')} options={moneyAccounts.map((h) => ({ value: h.id, label: h.name }))} />
            </Field>
            <Field label="How">
              <SelectInput value={f.method} onChange={set('method')} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))} />
            </Field>
            <Field label="Reference" hint="Optional">
              <TextInput value={f.reference} onChange={set('reference')} />
            </Field>
            <Field label="Receipt" hint="Optional - a photo or PDF">
              <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-[13px] text-ink-700" />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Record expense'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/** A supplier's bill, to pay later. */
export function NewBillButton({ headings, baseCurrency }: { headings: Option[]; baseCurrency: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ vendor: '', vendorReference: '', issueDate: today(), dueDate: today(), accountId: '', description: '', amount: '', taxAmount: '', currency: baseCurrency });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    const res = await callApi('/api/finance/bills', {
      method: 'POST',
      json: { ...f, vendorReference: f.vendorReference || null, amount: parseMoney(f.amount) ?? 0, taxAmount: f.taxAmount ? (parseMoney(f.taxAmount) ?? 0) : 0 },
    });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors);
      setError(res.message);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Add a bill</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add a bill" description="Something you owe a supplier. It is booked now and paid when you pay it." wide>
        <form onSubmit={submit} noValidate className="space-y-3">
          {error && <FormAlert>{error}</FormAlert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Supplier" error={errors.vendor}>
              <TextInput value={f.vendor} onChange={set('vendor')} />
            </Field>
            <Field label="Their bill number" hint="Optional">
              <TextInput value={f.vendorReference} onChange={set('vendorReference')} />
            </Field>
            <Field label="Dated" error={errors.issueDate}>
              <TextInput type="date" value={f.issueDate} onChange={set('issueDate')} />
            </Field>
            <Field label="Due" error={errors.dueDate}>
              <TextInput type="date" value={f.dueDate} onChange={set('dueDate')} />
            </Field>
            <Field label="What for" error={errors.accountId}>
              <SelectInput value={f.accountId} onChange={set('accountId')} placeholder="Choose a heading" options={headings.map((h) => ({ value: h.id, label: h.name }))} />
            </Field>
            <Field label="Description" error={errors.description}>
              <TextInput value={f.description} onChange={set('description')} />
            </Field>
            <Field label="Amount" error={errors.amount}>
              <TextInput value={f.amount} onChange={set('amount')} inputMode="decimal" />
            </Field>
            <Field label="Of which reclaimable tax" hint="Optional">
              <TextInput value={f.taxAmount} onChange={set('taxAmount')} inputMode="decimal" placeholder="0" />
            </Field>
            <Field label="Currency">
              <SelectInput value={f.currency} onChange={set('currency')} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Add bill'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function PayBillButton({ billId, moneyAccounts }: { billId: string; moneyAccounts: Option[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [paidOn, setPaidOn] = useState(today());
  const [from, setFrom] = useState(moneyAccounts.find((a) => /bank/i.test(a.name))?.id ?? moneyAccounts[0]?.id ?? '');
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Pay
      </Button>
    );
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <TextInput type="date" value={paidOn} onChange={setPaidOn} />
        <SelectInput value={from} onChange={setFrom} options={moneyAccounts.map((a) => ({ value: a.id, label: a.name }))} />
        <SelectInput value={method} onChange={setMethod} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))} />
        <TextInput value={reference} onChange={setReference} placeholder="Reference" />
      </div>
      {error && <p className="text-[12px] text-bad-700">{error}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const res = await callApi(`/api/finance/bills/${billId}/pay`, { method: 'POST', json: { paidOn, paidFromAccountId: from, method, reference: reference || null } });
            setBusy(false);
            if (!res.ok) return setError(res.message ?? Object.values(res.fieldErrors)[0] ?? 'That did not work.');
            router.refresh();
          }}
        >
          Record payment
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
