'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  localIsoDateIn,
  localIsoDate,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  formatMoney,
  parseMoney,
  splitInstallments,
  type InstallmentView,
  type OnlinePaymentView,
} from '@crm/shared';
import { Button, cx } from '../ui';
import { callApi, Field, SelectInput, TextArea, TextInput } from '../forms';
import { IconClose, IconPlus } from '../icons';

const today = () => localIsoDate();

export interface AccountOption {
  id: string;
  name: string;
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function run(url: string, json: unknown, after?: () => void) {
    setBusy(true);
    setError(null);
    setErrors({});
    const res = await callApi(url, { method: 'POST', json });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors);
      setError(res.message ?? Object.values(res.fieldErrors)[0] ?? 'That did not work.');
      return false;
    }
    after?.();
    router.refresh();
    return true;
  }
  return { busy, error, errors, run };
}

/** Approve or turn down an invoice whose discount went over the limit. */
export function ApprovalActions({ invoiceId }: { invoiceId: string }) {
  const { busy, error, run } = useAction();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-2">
      {!rejecting ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => run(`/api/billing/invoices/${invoiceId}/approve`, {})}>
            Approve and issue
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setRejecting(true)}>
            Turn down
          </Button>
        </div>
      ) : (
        <>
          <TextArea value={reason} onChange={setReason} rows={2} placeholder="Why - the person who wrote it is told" />
          <div className="flex gap-2">
            <Button variant="danger" size="sm" disabled={busy || reason.trim().length < 5} onClick={() => run(`/api/billing/invoices/${invoiceId}/reject`, { reason: reason.trim() })}>
              Turn it down
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
    </div>
  );
}

/** Set or replace how an issued invoice is paid in parts. */
export function InstallmentsEditor({
  invoiceId,
  total,
  currency,
  installments,
  issueDate,
}: {
  invoiceId: string;
  total: number;
  currency: string;
  installments: InstallmentView[];
  issueDate: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState(installments.map((i) => ({ dueDate: i.dueDate, amount: String(i.amount / 100) })));
  const [count, setCount] = useState(String(Math.max(2, installments.length || 3)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sum = parts.reduce((n, p) => n + (parseMoney(p.amount) ?? 0), 0);

  async function save(clear = false) {
    setBusy(true);
    setError(null);
    const res = await callApi(`/api/billing/invoices/${invoiceId}/installments`, {
      method: 'PUT',
      json: { installments: clear ? [] : parts.map((p) => ({ dueDate: p.dueDate, amount: parseMoney(p.amount) ?? 0 })) },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message ?? Object.values(res.fieldErrors)[0] ?? 'Could not save the schedule.');
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {installments.length ? 'Change the schedule' : 'Split into installments'}
      </Button>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <label className="w-20 text-[11.5px] text-ink-500">
          Parts
          <TextInput value={count} onChange={(v) => setCount(v.replace(/\D/g, ''))} inputMode="numeric" />
        </label>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setParts(splitInstallments(total, Math.max(2, Number(count) || 2), issueDate > today() ? issueDate : today()).map((p) => ({ dueDate: p.dueDate, amount: String(p.amount / 100) })))}
        >
          Split evenly
        </Button>
      </div>
      {parts.map((p, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] gap-2">
          <TextInput type="date" value={p.dueDate} onChange={(v) => setParts((ps) => ps.map((x, j) => (j === i ? { ...x, dueDate: v } : x)))} />
          <TextInput value={p.amount} onChange={(v) => setParts((ps) => ps.map((x, j) => (j === i ? { ...x, amount: v } : x)))} inputMode="decimal" />
          <button type="button" aria-label="Remove part" className="text-ink-400 hover:text-bad-600" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}>
            <IconClose size={14} />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button type="button" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand-700" onClick={() => setParts((ps) => [...ps, { dueDate: ps[ps.length - 1]?.dueDate ?? today(), amount: '' }])}>
          <IconPlus size={13} /> Add a part
        </button>
        <span className={cx('tnum text-[12px]', sum === total ? 'text-ok-700' : 'text-bad-700')}>
          {formatMoney(sum, currency)} of {formatMoney(total, currency)}
        </span>
      </div>
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || sum !== total || !parts.length} onClick={() => save()}>
          Save schedule
        </Button>
        {installments.length > 0 && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => save(true)}>
            Back to one payment
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Give part of an invoice back without voiding it. */
export function CreditNoteForm({ invoiceId, currency, room }: { invoiceId: string; currency: string; room: number }) {
  const { busy, error, errors, run } = useAction();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} disabled={room <= 0}>
        Issue a credit note
      </Button>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        const minor = parseMoney(amount);
        if (!minor) return;
        if (await run(`/api/billing/invoices/${invoiceId}/credit-notes`, { amount: minor, reason: reason.trim() })) setOpen(false);
      }}
    >
      <Field label={`Amount (${currency}), tax included`} hint={`Up to ${formatMoney(room, currency)}`} error={errors.amount}>
        <TextInput value={amount} onChange={setAmount} inputMode="decimal" />
      </Field>
      <Field label="Reason" error={errors.reason} hint="Printed on the credit note and kept on record">
        <TextInput value={reason} onChange={setReason} placeholder="e.g. Agreed discount after the delay" />
      </Field>
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !parseMoney(amount) || reason.trim().length < 5}>
          Issue credit note
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Ask for a refund, for someone else to approve. */
export function RefundRequestForm({ invoiceId, currency, max, accounts }: { invoiceId: string; currency: string; max: number; accounts: AccountOption[] }) {
  const { busy, error, errors, run } = useAction();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [accountId, setAccountId] = useState('');
  const [reason, setReason] = useState('');
  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} disabled={max <= 0}>
        Request a refund
      </Button>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        const minor = parseMoney(amount);
        if (!minor) return;
        if (await run(`/api/billing/invoices/${invoiceId}/refund-requests`, { amount: minor, method, accountId: accountId || null, reason: reason.trim() })) setOpen(false);
      }}
    >
      <Field label={`Amount (${currency})`} hint={`Up to ${formatMoney(max, currency)}`} error={errors.amount}>
        <TextInput value={amount} onChange={setAmount} inputMode="decimal" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Paid back by">
          <SelectInput value={method} onChange={setMethod} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))} />
        </Field>
        <Field label="From account">
          <SelectInput value={accountId} onChange={setAccountId} placeholder="By method" options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
        </Field>
      </div>
      <Field label="Reason" error={errors.reason}>
        <TextInput value={reason} onChange={setReason} placeholder="e.g. Visa refused - refund per our policy" />
      </Field>
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !parseMoney(amount) || reason.trim().length < 5}>
          Send for approval
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Approve or turn down a refund request. */
export function DecideRefund({ id }: { id: string }) {
  const { busy, error, run } = useAction();
  const [note, setNote] = useState('');
  const [turningDown, setTurningDown] = useState(false);
  return (
    <div className="space-y-2">
      {turningDown && <TextInput value={note} onChange={setNote} placeholder="Why it is turned down" />}
      <div className="flex flex-wrap gap-2">
        {!turningDown ? (
          <>
            <Button size="sm" disabled={busy} onClick={() => run(`/api/billing/refund-requests/${id}/decide`, { approve: true })}>
              Approve
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setTurningDown(true)}>
              Turn down
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="danger" disabled={busy || note.trim().length < 5} onClick={() => run(`/api/billing/refund-requests/${id}/decide`, { approve: false, note: note.trim() })}>
              Turn it down
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setTurningDown(false)}>
              Cancel
            </Button>
          </>
        )}
      </div>
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The student's side                                                  */
/* ------------------------------------------------------------------ */

/** Pay the next installment or the whole balance online. */
export function PayOnline({ invoiceId, currency, balance, nextDue }: { invoiceId: string; currency: string; balance: number; nextDue: { amount: number } | null }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function go(what: 'next' | 'balance') {
    setBusy(what);
    setError(null);
    const res = await callApi<OnlinePaymentView>(`/api/billing/invoices/${invoiceId}/pay-online`, { method: 'POST', json: { what } });
    if (!res.ok || !res.data?.url) {
      setBusy(null);
      setError(res.message ?? 'The payment page could not be opened.');
      return;
    }
    window.location.href = res.data.url;
  }
  return (
    <div className="space-y-2">
      {nextDue && nextDue.amount < balance && (
        <Button className="w-full" disabled={busy !== null} onClick={() => go('next')}>
          {busy === 'next' ? 'Opening…' : `Pay this installment · ${formatMoney(nextDue.amount, currency)}`}
        </Button>
      )}
      <Button className="w-full" variant={nextDue && nextDue.amount < balance ? 'secondary' : 'primary'} disabled={busy !== null} onClick={() => go('balance')}>
        {busy === 'balance' ? 'Opening…' : `Pay the balance · ${formatMoney(balance, currency)}`}
      </Button>
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
    </div>
  );
}

/** "I have paid": the slip or screenshot, for the consultancy to check. */
export function ProofForm({ invoiceId, currency, suggested }: { invoiceId: string; currency: string; suggested: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState(suggested > 0 ? String(suggested / 100) : '');
  const [method, setMethod] = useState('bank_transfer');
  const [paidOn, setPaidOn] = useState(today());
  const [reference, setReference] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const minor = parseMoney(amount);
    if (!minor) {
      setErrors({ amount: 'How much did you pay?' });
      return;
    }
    if (!file) {
      setErrors({ file: 'Attach the slip or a screenshot' });
      return;
    }
    const form = new FormData();
    form.append('amount', String(minor));
    form.append('method', method);
    form.append('paidOn', paidOn);
    if (reference.trim()) form.append('reference', reference.trim());
    form.append('file', file);
    setBusy(true);
    setErrors({});
    setError(null);
    const res = await callApi(`/api/billing/invoices/${invoiceId}/submissions`, { method: 'POST', form });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors);
      setError(res.message);
      return;
    }
    setDone(true);
    router.refresh();
  }

  if (done) {
    return <p className="rounded-lg bg-ok-50 px-3 py-2 text-[13px] text-ok-700">Thank you - we will check it and send your receipt.</p>;
  }
  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <Field label={`Amount you paid (${currency})`} error={errors.amount}>
        <TextInput value={amount} onChange={setAmount} inputMode="decimal" invalid={Boolean(errors.amount)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="How">
          <SelectInput value={method} onChange={setMethod} options={PAYMENT_METHODS.filter((m) => m !== 'card').map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))} />
        </Field>
        <Field label="When" error={errors.paidOn}>
          <TextInput type="date" value={paidOn} onChange={setPaidOn} />
        </Field>
      </div>
      <Field label="Transaction reference" hint="From the slip or the banking app, if there is one">
        <TextInput value={reference} onChange={setReference} placeholder="e.g. 0012 3345 9981" />
      </Field>
      <Field label="Slip or screenshot" error={errors.file}>
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-[13px] text-ink-700 file:mr-3 file:rounded-md file:border-0 file:bg-ink-100 file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-ink-800"
        />
      </Field>
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? 'Sending…' : 'Send proof of payment'}
      </Button>
    </form>
  );
}

/** Accept or decline a quote (the student, or staff on their behalf). */
export function QuoteDecision({ quoteId }: { quoteId: string }) {
  const { busy, error, run } = useAction();
  const [note, setNote] = useState('');
  return (
    <div className="space-y-2">
      <TextInput value={note} onChange={setNote} placeholder="A note, if you like" />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => run(`/api/billing/quotes/${quoteId}/accept`, { note: note.trim() || null })}>
          Accept
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => run(`/api/billing/quotes/${quoteId}/decline`, { note: note.trim() || null })}>
          Decline
        </Button>
      </div>
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
    </div>
  );
}

/** Turn an open or accepted quote into the invoice. */
export function ConvertQuote({ quoteId, detailBase }: { quoteId: string; detailBase: string }) {
  const router = useRouter();
  const [dueDate, setDueDate] = useState(localIsoDateIn(14));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Field label="Invoice due date">
        <TextInput type="date" value={dueDate} onChange={setDueDate} />
      </Field>
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
      <Button
        className="w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await callApi<{ id: string }>(`/api/billing/quotes/${quoteId}/convert`, { method: 'POST', json: { dueDate } });
          setBusy(false);
          if (!res.ok || !res.data) {
            setError(res.message ?? Object.values(res.fieldErrors)[0] ?? 'Could not invoice it.');
            return;
          }
          router.push(`${detailBase}/${res.data.id}`);
          router.refresh();
        }}
      >
        {busy ? 'Issuing…' : 'Issue the invoice'}
      </Button>
    </div>
  );
}
