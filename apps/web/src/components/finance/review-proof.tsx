'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatMoney, parseMoney } from '@crm/shared';
import { Button } from '../ui';
import { callApi, Field, SelectInput, TextInput } from '../forms';

/** Approve (recording what actually arrived, where) or reject with a reason the student sees. */
export function ReviewProof({
  id,
  amount,
  currency,
  paidOn,
  accounts,
}: {
  id: string;
  amount: number;
  currency: string;
  paidOn: string;
  accounts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle');
  const [received, setReceived] = useState(String(amount / 100));
  const [on, setOn] = useState(paidOn);
  const [accountId, setAccountId] = useState(accounts.find((a) => /bank/i.test(a.name))?.id ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(approve: boolean) {
    setBusy(true);
    setError(null);
    const res = await callApi(`/api/billing/submissions/${id}/review`, {
      method: 'POST',
      json: approve ? { approve, amount: parseMoney(received) ?? amount, receivedOn: on, accountId: accountId || null, note: note.trim() || null } : { approve, note: note.trim() },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message ?? Object.values(res.fieldErrors)[0] ?? 'That did not work.');
      return;
    }
    router.refresh();
  }

  if (mode === 'idle') {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setMode('approve')}>
          It arrived
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setMode('reject')}>
          Cannot confirm
        </Button>
      </div>
    );
  }
  if (mode === 'reject') {
    return (
      <div className="space-y-2">
        <TextInput value={note} onChange={setNote} placeholder="What is wrong - the student is told" />
        {error && <p className="text-[12px] text-bad-700">{error}</p>}
        <div className="flex gap-2">
          <Button size="sm" variant="danger" disabled={busy || note.trim().length < 5} onClick={() => send(false)}>
            Send back
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label={`Amount received (${currency})`} hint={`Claimed ${formatMoney(amount, currency)}`}>
          <TextInput value={received} onChange={setReceived} inputMode="decimal" />
        </Field>
        <Field label="Received on">
          <TextInput type="date" value={on} onChange={setOn} />
        </Field>
      </div>
      <Field label="Into">
        <SelectInput value={accountId} onChange={setAccountId} placeholder="By method" options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
      </Field>
      <TextInput value={note} onChange={setNote} placeholder="Note (optional)" />
      {error && <p className="text-[12px] text-bad-700">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !parseMoney(received)} onClick={() => send(true)}>
          Record payment and send receipt
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
