'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { localIsoDateIn, localIsoDate, ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL, CURRENCIES, formatMoney, parseMoney, type LedgerAccountView } from '@crm/shared';
import { Button, cx } from '../ui';
import { callApi, Field, FormAlert, SelectInput, TextInput } from '../forms';
import { Modal } from '../modal';
import { IconClose, IconPlus } from '../icons';

const SUBTYPES = [
  { value: '', label: 'Ordinary' },
  { value: 'bank', label: 'A bank account (can be reconciled, takes payments)' },
  { value: 'cash', label: 'Cash (takes payments, counted daily)' },
  { value: 'clearing', label: 'Online wallet or card processor' },
];

/** Add an account, or change one. System accounts keep their type. */
export function AccountButton({ account }: { account?: LedgerAccountView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    code: account?.code ?? '',
    name: account?.name ?? '',
    type: account?.type ?? 'expense',
    subtype: account?.subtype ?? '',
    currency: account?.currency ?? '',
    description: account?.description ?? '',
    active: account?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const system = Boolean(account?.systemKey);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    const res = await callApi(account ? `/api/finance/accounts/${account.id}` : '/api/finance/accounts', {
      method: account ? 'PUT' : 'POST',
      json: { ...f, subtype: f.subtype || null, currency: f.currency || null, description: f.description || null },
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
      {account ? (
        <button type="button" className="text-[12.5px] font-medium text-brand-700 hover:underline" onClick={() => setOpen(true)}>
          Edit
        </button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <IconPlus size={15} />
          Add account
        </Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={account ? `Edit ${account.name}` : 'Add an account'} description={system ? 'The system posts to this account, so its type stays as it is.' : 'A heading for expenses, another bank account, a loan...'}>
        <form onSubmit={submit} noValidate className="space-y-3">
          {error && <FormAlert>{error}</FormAlert>}
          <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
            <Field label="Code" error={errors.code}>
              <TextInput value={f.code} onChange={(v) => setF((x) => ({ ...x, code: v.replace(/\D/g, '') }))} inputMode="numeric" placeholder="5150" />
            </Field>
            <Field label="Name" error={errors.name}>
              <TextInput value={f.name} onChange={(v) => setF((x) => ({ ...x, name: v }))} />
            </Field>
          </div>
          {!system && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <SelectInput value={f.type} onChange={(v) => setF((x) => ({ ...x, type: v as typeof f.type }))} options={ACCOUNT_TYPES.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] }))} />
              </Field>
              {f.type === 'asset' && (
                <Field label="Kind">
                  <SelectInput value={f.subtype} onChange={(v) => setF((x) => ({ ...x, subtype: v }))} options={SUBTYPES} />
                </Field>
              )}
            </div>
          )}
          {(f.subtype === 'bank' || f.subtype === 'cash' || f.subtype === 'clearing') && (
            <Field label="Held in" hint="Optional - for an account in one currency">
              <SelectInput value={f.currency} onChange={(v) => setF((x) => ({ ...x, currency: v }))} placeholder="Any" options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
            </Field>
          )}
          <Field label="Description" hint="Optional">
            <TextInput value={f.description} onChange={(v) => setF((x) => ({ ...x, description: v }))} />
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-ink-700">
            <input type="checkbox" checked={f.active} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} /> In use
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

interface EntryLine {
  accountId: string;
  debit: string;
  credit: string;
  description: string;
}

/** A journal entry by hand: owner's money in, a depreciation, a correction. */
export function ManualEntryButton({ accounts, baseCurrency }: { accounts: { id: string; name: string }[]; baseCurrency: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [entryDate, setEntryDate] = useState(localIsoDate());
  const [memo, setMemo] = useState('');
  const [currency, setCurrency] = useState(baseCurrency);
  const [fxRate, setFxRate] = useState('');
  const blank = (): EntryLine => ({ accountId: '', debit: '', credit: '', description: '' });
  const [lines, setLines] = useState<EntryLine[]>([blank(), blank()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const debits = lines.reduce((n, l) => n + (parseMoney(l.debit) ?? 0), 0);
  const credits = lines.reduce((n, l) => n + (parseMoney(l.credit) ?? 0), 0);
  const set = (i: number, patch: Partial<EntryLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await callApi('/api/finance/journal', {
      method: 'POST',
      json: {
        entryDate,
        memo,
        currency,
        fxRate: currency !== baseCurrency && fxRate ? Number(fxRate) : null,
        lines: lines.filter((l) => l.accountId).map((l) => ({ accountId: l.accountId, debit: parseMoney(l.debit) ?? 0, credit: parseMoney(l.credit) ?? 0, description: l.description || null })),
      },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message ?? Object.values(res.fieldErrors)[0] ?? 'Could not post it.');
      return;
    }
    setOpen(false);
    setMemo('');
    setLines([blank(), blank()]);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <IconPlus size={15} />
        Manual entry
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="A journal entry by hand" description="For what no document records: money the owners put in or take out, depreciation, a correction. Debits must equal credits." wide>
        <form onSubmit={submit} noValidate className="space-y-3">
          {error && <FormAlert>{error}</FormAlert>}
          <div className="grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)_110px]">
            <Field label="Date">
              <TextInput type="date" value={entryDate} onChange={setEntryDate} />
            </Field>
            <Field label="What it is">
              <TextInput value={memo} onChange={setMemo} placeholder="e.g. Owner’s capital introduced" />
            </Field>
            <Field label="Currency">
              <SelectInput value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
            </Field>
          </div>
          {currency !== baseCurrency && (
            <Field label={`Rate to ${baseCurrency}`} hint="Optional">
              <TextInput value={fxRate} onChange={setFxRate} inputMode="decimal" />
            </Field>
          )}
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_100px_100px_28px] gap-2">
                <SelectInput value={l.accountId} onChange={(v) => set(i, { accountId: v })} placeholder="Account…" options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
                <TextInput value={l.debit} onChange={(v) => set(i, { debit: v, credit: v ? '' : l.credit })} inputMode="decimal" placeholder="Debit" />
                <TextInput value={l.credit} onChange={(v) => set(i, { credit: v, debit: v ? '' : l.debit })} inputMode="decimal" placeholder="Credit" />
                <button type="button" aria-label="Remove line" className="text-ink-400 hover:text-bad-600" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length <= 2}>
                  <IconClose size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <button type="button" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand-700" onClick={() => setLines((ls) => [...ls, blank()])}>
              <IconPlus size={13} /> Add a line
            </button>
            <span className={cx('tnum text-[12.5px]', debits === credits && debits > 0 ? 'text-ok-700' : 'text-bad-700')}>
              Debits {formatMoney(debits, currency)} · credits {formatMoney(credits, currency)}
            </span>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || debits !== credits || debits === 0 || memo.trim().length < 3}>
              {busy ? 'Posting…' : 'Post entry'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/** Close the books up to a date, or (managers) reopen them. */
export function PeriodLock({ lockedThrough, canReopen }: { lockedThrough: string | null; canReopen: boolean }) {
  const router = useRouter();
  const yesterday = localIsoDateIn(-1);
  const [through, setThrough] = useState(lockedThrough ?? yesterday);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function send(value: string | null) {
    setBusy(true);
    setError(null);
    const res = await callApi('/api/finance/lock', { method: 'POST', json: { through: value } });
    setBusy(false);
    if (!res.ok) return setError(res.message ?? Object.values(res.fieldErrors)[0] ?? 'That did not work.');
    router.refresh();
  }
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-ink-600">{lockedThrough ? `Closed up to ${lockedThrough}. Nothing can be dated on or before it.` : 'No period is closed.'}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-44">
          <TextInput type="date" value={through} onChange={setThrough} />
        </div>
        <Button variant="secondary" disabled={busy || !through} onClick={() => send(through)}>
          Close up to this day
        </Button>
        {lockedThrough && canReopen && (
          <Button variant="ghost" disabled={busy} onClick={() => send(null)}>
            Reopen all
          </Button>
        )}
      </div>
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
    </div>
  );
}
