'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  CURRENCIES,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  formatMoney,
  localIsoDate,
  parseMoney,
  type Currency,
} from '@crm/shared';
import { Button, Card } from '../ui';
import { callApi, Field, FormAlert, SelectInput, TextInput } from '../forms';

/**
 * Money received from a consultancy for the platform. Saving it moves the
 * paid-until date on by the months it covers, opens the consultancy again if
 * it was read-only, and emails its managers a receipt.
 */
export function RecordSubscriptionPayment({
  tenantId,
  currency: defaultCurrency,
  monthlyPrice,
}: {
  tenantId: string;
  currency: Currency;
  /** The plan's price, to suggest the amount for the months chosen. */
  monthlyPrice: number | null;
}) {
  const router = useRouter();
  const [months, setMonths] = useState('1');
  const [currency, setCurrency] = useState<string>(defaultCurrency);
  const [amount, setAmount] = useState(monthlyPrice ? String(monthlyPrice / 100) : '');
  const [receivedOn, setReceivedOn] = useState(localIsoDate());
  const [method, setMethod] = useState<string>('bank_transfer');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function pickMonths(v: string) {
    setMonths(v);
    // Keep the suggested amount in step with the months, until someone types their own.
    const n = Number(v);
    if (monthlyPrice && n > 0 && (amount === '' || parseMoney(amount) === monthlyPrice * Number(months))) {
      setAmount(String((monthlyPrice * n) / 100));
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const minor = parseMoney(amount);
    if (!minor || minor <= 0) {
      setErrors({ amount: 'Enter the amount received.' });
      return;
    }
    setBusy(true);
    setErrors({});
    setNote(null);
    const res = await callApi<{ subscription: { paidUntil: string | null } }>(`/api/admin/tenants/${tenantId}/payments`, {
      method: 'POST',
      json: { amount: minor, currency, months: Number(months), receivedOn, method, reference: reference || undefined },
    });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors);
      setNote(res.message ? { tone: 'bad', text: res.message } : null);
      return;
    }
    setReference('');
    setNote({
      tone: 'ok',
      text: `Recorded ${formatMoney(minor, currency)}. Paid until ${res.data?.subscription.paidUntil ?? '--'}; the managers have been emailed a receipt.`,
    });
    router.refresh();
  }

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold text-ink-950">Record a payment</h2>
      <p className="mt-0.5 text-[12.5px] text-ink-400">Moves the paid-until date on and emails the managers a receipt.</p>
      <form onSubmit={save} className="mt-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Months it covers" error={errors.months}>
            <SelectInput value={months} onChange={pickMonths} options={[1, 2, 3, 6, 12, 24].map((n) => ({ value: String(n), label: n === 1 ? '1 month' : `${n} months` }))} />
          </Field>
          <Field label="Received on" error={errors.receivedOn}>
            <TextInput type="date" value={receivedOn} onChange={setReceivedOn} invalid={Boolean(errors.receivedOn)} />
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_6.5rem] gap-3">
          <Field label="Amount received" error={errors.amount}>
            <TextInput value={amount} onChange={setAmount} inputMode="decimal" invalid={Boolean(errors.amount)} />
          </Field>
          <Field label="Currency">
            <SelectInput value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="How">
            <SelectInput value={method} onChange={setMethod} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))} />
          </Field>
          <Field label="Reference" error={errors.reference}>
            <TextInput value={reference} onChange={setReference} placeholder="e.g. HBL-48291" />
          </Field>
        </div>
        {note && <FormAlert tone={note.tone}>{note.text}</FormAlert>}
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Recording…' : 'Record payment'}
        </Button>
      </form>
    </Card>
  );
}
