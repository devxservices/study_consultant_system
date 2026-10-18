'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, formatMoney, parseMoney } from '@crm/shared';
import { Button, cx } from '../ui';
import { callApi, Field, SelectInput, TextInput } from '../forms';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Recording money that has actually moved. The amount starts at what is still
 * owed, because paying the balance is the common case; a manager can switch to
 * recording a refund instead.
 */
export function PaymentForm({
  invoiceId,
  currency,
  balance,
  paid,
  canRefund,
  accounts = [],
}: {
  invoiceId: string;
  currency: string;
  balance: number;
  paid: number;
  canRefund: boolean;
  /** Cash, bank and online accounts to record it against; by method when not chosen. */
  accounts?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [kind, setKind] = useState<'payment' | 'refund'>('payment');
  const [amount, setAmount] = useState(balance > 0 ? String(balance / 100) : '');
  const [method, setMethod] = useState('bank_transfer');
  const [receivedOn, setReceivedOn] = useState(today());
  const [reference, setReference] = useState('');
  const [accountId, setAccountId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setError(null);
    const minor = parseMoney(amount);
    if (!minor) {
      setErrors({ amount: 'Enter an amount, like 50000' });
      return;
    }
    setBusy(true);
    const res = await callApi(`/api/billing/invoices/${invoiceId}/payments`, {
      method: 'POST',
      json: { kind, amount: minor, method, receivedOn, reference: reference.trim() || undefined, accountId: accountId || undefined },
    });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors);
      setError(res.message);
      return;
    }
    setReference('');
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      {canRefund && paid > 0 && (
        <div className="grid grid-cols-2 rounded-lg border border-line bg-ink-50 p-1" role="group" aria-label="Entry type">
          {(['payment', 'refund'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setKind(k);
                setAmount(k === 'payment' ? (balance > 0 ? String(balance / 100) : '') : '');
              }}
              className={cx(
                'h-8 rounded-md text-[13px] font-medium',
                kind === k ? 'bg-paper text-ink-950 shadow-sm' : 'text-ink-500',
              )}
            >
              {k === 'payment' ? 'Payment' : 'Refund'}
            </button>
          ))}
        </div>
      )}
      <Field
        label={kind === 'refund' ? `Refund amount (${currency})` : `Amount received (${currency})`}
        error={errors.amount}
        hint={kind === 'refund' ? `Up to ${formatMoney(paid, currency)}` : undefined}
      >
        <TextInput value={amount} onChange={setAmount} inputMode="decimal" invalid={Boolean(errors.amount)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Method">
          <SelectInput
            value={method}
            onChange={setMethod}
            options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))}
          />
        </Field>
        <Field label="Date" error={errors.receivedOn}>
          <TextInput type="date" value={receivedOn} onChange={setReceivedOn} invalid={Boolean(errors.receivedOn)} />
        </Field>
      </div>
      {accounts.length > 0 && (
        <Field label={kind === 'refund' ? 'Paid out of' : 'Paid into'} hint="Leave it to go by the method">
          <SelectInput value={accountId} onChange={setAccountId} placeholder="By method" options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
        </Field>
      )}
      <Field label="Reference" hint="Bank or transaction reference, if there is one">
        <TextInput value={reference} onChange={setReference} placeholder="e.g. TRX482913" />
      </Field>
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
      <Button type="submit" className="w-full" variant={kind === 'refund' ? 'danger' : 'primary'} disabled={busy}>
        {busy ? 'Recording…' : kind === 'refund' ? 'Record refund' : 'Record payment'}
      </Button>
    </form>
  );
}

export function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()} className="print:hidden">
      {label}
    </Button>
  );
}
