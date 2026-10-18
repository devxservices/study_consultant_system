'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PasswordLinkResult } from '@crm/shared';
import { Button, Card, Pill } from './ui';
import { callApi, TextInput } from './forms';
import { SentLink } from './password-link';

/** A readable temporary password: two words and digits, easy to say on the phone. */
function suggest(): string {
  const words = ['green', 'river', 'maple', 'orbit', 'pearl', 'cedar', 'amber', 'delta', 'lotus', 'coral'];
  const pick = () => words[Math.floor(Math.random() * words.length)]!;
  return `${pick()}-${pick()}-${Math.floor(100 + Math.random() * 900)}`;
}

/**
 * The client's portal login. The usual way in is an invitation: they get an
 * email (and staff get the same link for WhatsApp) and choose their own
 * password, so nobody on staff ever knows it. Setting a password for them is
 * still there, for someone sitting at the desk without their phone.
 */
export function PortalAccessCard({
  clientId,
  name,
  email,
  hasLogin,
  everHadLogin,
  twoStep = false,
  canManage = true,
}: {
  clientId: string;
  name: string;
  email: string;
  hasLogin: boolean;
  everHadLogin: boolean;
  /** Their login has two-step verification on. */
  twoStep?: boolean;
  /** Whether this member of staff may change the login. Without it the card only reports. */
  canManage?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'set'>('idle');
  const [password, setPassword] = useState(suggest());
  const [shared, setShared] = useState<string | null>(null);
  const [sent, setSent] = useState<PasswordLinkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function invite() {
    setBusy(true);
    setError(null);
    setShared(null);
    const res = await callApi<PasswordLinkResult>(`/api/clients/${clientId}/portal-invite`, { method: 'POST' });
    setBusy(false);
    if (!res.ok || !res.data) {
      setError(res.message ?? 'That did not work. Please try again.');
      return;
    }
    setSent(res.data);
    router.refresh();
  }

  async function grant() {
    setBusy(true);
    setError(null);
    const res = await callApi(`/api/clients/${clientId}/portal-access`, { method: 'POST', json: { password } });
    setBusy(false);
    if (!res.ok) {
      setError(res.fieldErrors.password ?? res.message);
      return;
    }
    setSent(null);
    setShared(password);
    setMode('idle');
    router.refresh();
  }

  async function revoke() {
    if (!confirm('Switch off their portal login? They keep everything; they just cannot sign in.')) return;
    setBusy(true);
    const res = await callApi(`/api/clients/${clientId}/portal-access`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) setError(res.message);
    else {
      setSent(null);
      setShared(null);
      router.refresh();
    }
  }

  async function resetTwoStep() {
    if (!confirm('Reset their two-step verification? Their authenticator app and recovery codes stop working, and they sign in with their password until they set it up again.')) return;
    setBusy(true);
    setError(null);
    const res = await callApi(`/api/clients/${clientId}/mfa`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) setError(res.message);
    else router.refresh();
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15.5px] font-medium text-ink-950">Portal access</h2>
        {hasLogin ? (
          <Pill tone="ok" dot>
            Active
          </Pill>
        ) : (
          <Pill tone="warn" dot>
            {everHadLogin ? 'Switched off' : 'Not set up'}
          </Pill>
        )}
      </div>
      <p className="mt-2 text-[13px] text-ink-600">
        {hasLogin
          ? `They sign in with ${email} to follow their case, upload documents and pay.`
          : `Invite them to sign in with ${email} to upload documents, see progress and message their consultant.`}
      </p>

      {sent && <SentLink result={sent} email={email} name={name} />}

      {shared && (
        <div className="mt-3 rounded-lg border border-ok-200 bg-ok-50 p-3 text-[13px] text-ok-700">
          Share these with the client now - the password is not shown again:
          <p className="mt-1.5 font-mono text-[13px] text-ink-900">{email}</p>
          <p className="font-mono text-[13px] text-ink-900">{shared}</p>
        </div>
      )}

      {hasLogin && twoStep && (
        <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-ink-500">
          <Pill tone="ok" dot>
            Two-step on
          </Pill>
          {canManage && (
            <button type="button" onClick={resetTwoStep} disabled={busy} className="font-medium text-brand-700 hover:underline">
              Reset
            </button>
          )}
        </p>
      )}

      {!canManage ? (
        <p className="mt-3 text-[12px] text-ink-400">Ask a manager to give or reset their login.</p>
      ) : mode === 'set' ? (
        <div className="mt-3 space-y-2">
          <p className="text-[12.5px] text-ink-500">Choose a password to tell them in person. They can change it after signing in.</p>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <TextInput value={password} onChange={setPassword} />
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPassword(suggest())} className="h-10">
              New
            </Button>
          </div>
          {error && <p className="text-[12px] text-bad-700">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={grant} disabled={busy || password.length < 8}>
              {busy ? 'Saving…' : hasLogin ? 'Set new password' : 'Give access'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant={hasLogin ? 'secondary' : 'primary'} onClick={invite} disabled={busy}>
            {busy ? 'Sending…' : hasLogin ? 'Send a password reset link' : everHadLogin ? 'Switch on and invite' : 'Invite to the portal'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setShared(null);
              setSent(null);
              setMode('set');
            }}
          >
            {hasLogin ? 'Set a password' : 'Set a password instead'}
          </Button>
          {hasLogin && (
            <Button size="sm" variant="ghost" onClick={revoke} disabled={busy}>
              Switch off
            </Button>
          )}
          {error && <p className="w-full text-[12px] text-bad-700">{error}</p>}
        </div>
      )}
    </Card>
  );
}
