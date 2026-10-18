'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, INPUT, SUBMIT, Spinner } from '../sign-in/sign-in-form';

/** Typed twice, because a typo here locks the person out of an account they just set up. */
export function ResetForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError('The two passwords are not the same.');
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/password/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string; fieldErrors?: Record<string, string> } | null;
        setError(body?.fieldErrors?.password ?? body?.message ?? 'That did not work. Please try again.');
        setBusy(false);
        return;
      }
      router.replace(`/sign-in?done=password&email=${encodeURIComponent(email)}`);
    } catch {
      setError('Cannot reach the server. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {error && <Alert key={error}>{error}</Alert>}
      {/* Lets password managers save the new password against the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <div>
        <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-ink-800">
          New password
        </label>
        <div className="relative">
          <input
            id="password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${INPUT} pr-16`}
            placeholder="At least 8 characters"
            aria-invalid={tooShort}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-pressed={show}
            className="press absolute right-1.5 top-1/2 h-8 -translate-y-1/2 rounded-md px-2.5 text-[12.5px] font-medium text-ink-500 hover:bg-ink-50 hover:text-ink-900"
          >
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
        {tooShort && <p className="mt-1.5 text-[12.5px] text-ink-500">Use at least 8 characters.</p>}
      </div>
      <div>
        <label htmlFor="confirm" className="mb-1.5 block text-[13px] font-medium text-ink-800">
          Type it again
        </label>
        <input
          id="confirm"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={INPUT}
          aria-invalid={mismatch}
        />
        {mismatch && <p className="mt-1.5 text-[12.5px] text-bad-700">Not the same as above yet.</p>}
      </div>
      <button type="submit" disabled={busy || password.length < 8 || password !== confirm} className={SUBMIT}>
        {busy && <Spinner />}
        {busy ? 'Saving…' : 'Save my password'}
      </button>
    </form>
  );
}
