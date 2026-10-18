'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PasswordLinkResult } from '@crm/shared';
import { Button } from './ui';
import { callApi, Field, TextInput } from './forms';
import { SentLink } from './password-link';

/**
 * A manager's controls for one consultant: capacity, a link to choose a new
 * password (or a password set for them) when they are locked out, and switching their login off when they leave. Switching off
 * keeps every client, case and audit entry - reassign their clients separately.
 */
export function StaffActions({
  consultantId,
  name,
  email,
  active,
  maxActiveClients,
}: {
  consultantId: string;
  name: string;
  email: string;
  active: boolean;
  maxActiveClients: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [capacity, setCapacity] = useState(String(maxActiveClients));
  const [password, setPassword] = useState('');
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<PasswordLinkResult | null>(null);

  async function sendLink() {
    setBusy(true);
    setNote(null);
    const res = await callApi<PasswordLinkResult>(`/api/consultants/${consultantId}/password-link`, { method: 'POST' });
    setBusy(false);
    if (!res.ok || !res.data) {
      setNote({ tone: 'bad', text: res.message ?? 'That did not work.' });
      return;
    }
    setSent(res.data);
  }

  async function patch(json: Record<string, unknown>, ok: string) {
    setBusy(true);
    setNote(null);
    const res = await callApi(`/api/consultants/${consultantId}`, { method: 'PATCH', json });
    setBusy(false);
    if (!res.ok) {
      setNote({ tone: 'bad', text: res.message ?? Object.values(res.fieldErrors)[0] ?? 'That did not work.' });
      return;
    }
    setNote({ tone: 'ok', text: ok });
    router.refresh();
  }

  async function reset() {
    setBusy(true);
    setNote(null);
    const res = await callApi(`/api/consultants/${consultantId}/password`, { method: 'POST', json: { password } });
    setBusy(false);
    if (!res.ok) {
      setNote({ tone: 'bad', text: res.fieldErrors.password ?? res.message ?? 'That did not work.' });
      return;
    }
    setNote({ tone: 'ok', text: `Password set. Share it with ${name.split(' ')[0]} directly.` });
    setPassword('');
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[12.5px] font-medium text-brand-700 hover:underline">
        Manage
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-line bg-ink-50 p-3">
      <div className="flex items-end gap-2">
        <Field label="Client capacity" className="flex-1">
          <TextInput value={capacity} onChange={setCapacity} inputMode="numeric" />
        </Field>
        <Button size="sm" variant="secondary" className="h-10" disabled={busy} onClick={() => patch({ maxActiveClients: Number(capacity) }, 'Capacity saved.')}>
          Save
        </Button>
      </div>
      {active && (
        <div>
          <Button size="sm" variant="secondary" disabled={busy} onClick={sendLink}>
            Send a link to choose a password
          </Button>
          {sent && <SentLink result={sent} email={email} name={name} />}
        </div>
      )}
      <div className="flex items-end gap-2">
        <Field label="Or set a password for them" className="flex-1">
          <TextInput value={password} onChange={setPassword} placeholder="At least 8 characters" />
        </Field>
        <Button size="sm" variant="secondary" className="h-10" disabled={busy || password.length < 8} onClick={reset}>
          Set
        </Button>
      </div>
      {note && <p className={note.tone === 'ok' ? 'text-[12.5px] text-ok-700' : 'text-[12.5px] text-bad-700'}>{note.text}</p>}
      <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
        {active ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-bad-700"
            disabled={busy}
            onClick={() => {
              if (confirm(`Switch off ${name}'s login? Their clients stay assigned to them until you reassign them.`)) {
                void patch({ active: false }, 'Login switched off.');
              }
            }}
          >
            Switch off login
          </Button>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => patch({ active: true }, 'Login switched back on.')}>
            Switch login back on
          </Button>
        )}
        <button type="button" onClick={() => setOpen(false)} className="text-[12.5px] text-ink-500 hover:text-ink-800">
          Close
        </button>
      </div>
    </div>
  );
}
