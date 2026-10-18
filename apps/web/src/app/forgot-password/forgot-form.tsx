'use client';

import { useState, type FormEvent } from 'react';
import { Alert, INPUT, SUBMIT, Spinner } from '../sign-in/sign-in-form';

/**
 * Always ends on the same message whether or not the email has an account:
 * telling a stranger which emails are registered here is not ours to give.
 */
export function ForgotForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/password/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string; fieldErrors?: Record<string, string> } | null;
        setError(
          body?.fieldErrors?.email ??
            body?.message ??
            (res.status === 429 ? 'Too many attempts. Please wait a few minutes.' : 'That did not work. Please try again.'),
        );
        return;
      }
      setSentTo(email.trim());
    } catch {
      setError('Cannot reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <div role="status" className="rounded-lg bg-ok-50 px-4 py-3.5 text-[13.5px] leading-relaxed text-ok-700 ring-1 ring-ok-200">
        <p className="font-medium">Check your email.</p>
        <p className="mt-1">
          If <span className="font-medium">{sentTo}</span> has an account here, a link to choose a new password is on its way.
          It works for one hour. Not there in a few minutes? Look in spam, or ask your consultancy to send you one.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {error && <Alert key={error}>{error}</Alert>}
      <div>
        <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-ink-800">
          Email address
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={INPUT}
          placeholder="you@example.com"
        />
      </div>
      <button type="submit" disabled={busy || !email.trim()} className={SUBMIT}>
        {busy && <Spinner />}
        {busy ? 'Sending…' : 'Send me a link'}
      </button>
    </form>
  );
}
