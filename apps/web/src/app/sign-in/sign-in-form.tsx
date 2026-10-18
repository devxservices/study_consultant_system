'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ROLE_HOME, type AuthUser } from '@crm/shared';
import { cx } from '@/components/ui';

export const INPUT =
  'h-11 w-full rounded-lg border border-line-strong bg-paper px-3.5 text-[15px] text-ink-900 placeholder:text-ink-300 ' +
  'transition-[border-color,box-shadow] duration-150 focus:border-brand-500 focus:shadow-[0_0_0_4px_var(--color-brand-100)] focus:outline-none';

export const SUBMIT =
  'press flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 text-[15px] font-medium text-white ' +
  'shadow-[0_8px_20px_-10px_var(--color-brand-600)] hover:brightness-[0.93] disabled:opacity-50';

/** Inside the button, so the press is answered on the same frame as the click. */
export function Spinner() {
  return <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-white border-r-transparent" />;
}

/** An error that arrives nudges once, so a second wrong password still registers. */
export function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="animate-[shake_0.38s_ease-in-out] rounded-lg bg-bad-50 px-3.5 py-2.5 text-[13px] text-bad-700 ring-1 ring-bad-200"
    >
      {children}
    </div>
  );
}

/**
 * What to say when the API sends no message of its own.
 *
 * The distinction that matters is whose fault it is: a 401 means try another
 * password, a 500 means the password was never checked and retrying it will
 * not help. Telling someone the wrong one of those wastes their afternoon.
 */
function defaultMessage(status: number): string {
  if (status >= 500) {
    return 'The server is not responding. This is not your password - please try again shortly.';
  }
  if (status === 429) return 'Too many attempts. Please wait a moment and try again.';
  return 'That email and password do not match an account.';
}

export function SignInForm({ initialEmail = '' }: { initialEmail?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  /** Set once the password checks out for someone with two-step verification on. */
  const [challenge, setChallenge] = useState<string | null>(null);

  function signedIn(user: AuthUser) {
    // replace() so the back button does not return to the sign-in screen.
    router.replace(ROLE_HOME[user.role]);
    router.refresh();
  }

  if (challenge) {
    return (
      <SecondStep
        challenge={challenge}
        onDone={signedIn}
        onRestart={(message) => {
          setChallenge(null);
          setPassword('');
          setBusy(false);
          setError(message);
        }}
      />
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const res = await fetch('/api/auth/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        // A 5xx is not a credentials problem, and saying "could not sign in,
        // please try again" sends someone to re-type a password that was
        // correct. Server faults get named as server faults.
        setError(body?.message ?? defaultMessage(res.status));
        setBusy(false);
        return;
      }

      const body = (await res.json()) as { user: AuthUser } | { mfaRequired: true; challenge: string };
      if ('mfaRequired' in body) {
        setChallenge(body.challenge);
        setBusy(false);
        return;
      }
      signedIn(body.user);
    } catch {
      setError('Cannot reach the server. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {error && <Alert key={error}>{error}</Alert>}

      <div>
        <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-ink-800">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={INPUT}
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-ink-800">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={cx(INPUT, 'pr-16')}
            placeholder="Your password"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-pressed={showPassword}
            aria-controls="password"
            className="press absolute right-1.5 top-1/2 h-8 -translate-y-1/2 rounded-md px-2.5 text-[12.5px] font-medium text-ink-500 hover:bg-ink-50 hover:text-ink-900"
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      <button type="submit" disabled={busy || !email || !password} className={SUBMIT}>
        {busy && <Spinner />}
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

/**
 * The second half of a two-step sign-in: a code from the authenticator app,
 * or one of the recovery codes for someone without their phone. The password
 * is not asked for again unless the five minutes run out or too many codes
 * are wrong.
 */
function SecondStep({
  challenge,
  onDone,
  onRestart,
}: {
  challenge: string;
  onDone: (user: AuthUser) => void;
  onRestart: (message: string) => void;
}) {
  const [recovery, setRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, [recovery]);

  const ready = recovery ? value.replace(/[^a-z0-9]/gi, '').length === 10 : value.replace(/\s/g, '').length === 6;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recovery ? { challenge, recoveryCode: value } : { challenge, code: value }),
      });
      const body = (await res.json().catch(() => null)) as
        | { user?: AuthUser; message?: string; fieldErrors?: Record<string, string> }
        | null;
      if (res.ok && body?.user) {
        onDone(body.user);
        return;
      }
      const message = body?.message ?? body?.fieldErrors?.code ?? defaultMessage(res.status);
      // An expired or burnt challenge cannot be retried - back to the password.
      if (res.status === 401 && /again|too long|too many/i.test(message)) {
        onRestart(message);
        return;
      }
      setError(message);
      setValue('');
      setBusy(false);
    } catch {
      setError('Cannot reach the server. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="rounded-lg bg-info-50 px-3.5 py-3 text-[13.5px] leading-relaxed text-ink-700 ring-1 ring-info-100">
        {recovery
          ? 'Enter one of the recovery codes you saved when you set up two-step verification. Each one works once.'
          : 'Open your authenticator app and enter the 6-digit code it shows for this account.'}
      </div>

      {error && <Alert key={error}>{error}</Alert>}

      <div>
        <label htmlFor="second-step" className="mb-1.5 block text-[13px] font-medium text-ink-800">
          {recovery ? 'Recovery code' : 'Code from your app'}
        </label>
        <input
          ref={input}
          id="second-step"
          name={recovery ? 'recovery-code' : 'one-time-code'}
          autoComplete={recovery ? 'off' : 'one-time-code'}
          inputMode={recovery ? 'text' : 'numeric'}
          value={value}
          onChange={(e) =>
            setValue(recovery ? e.target.value.toUpperCase().slice(0, 12) : e.target.value.replace(/[^\d\s]/g, '').slice(0, 7))
          }
          placeholder={recovery ? 'XXXXX-XXXXX' : '123 456'}
          className={cx(INPUT, 'h-12 text-center font-mono text-[20px] tracking-[0.2em]')}
        />
      </div>

      <button type="submit" disabled={busy || !ready} className={SUBMIT}>
        {busy && <Spinner />}
        {busy ? 'Checking…' : 'Verify and sign in'}
      </button>

      <div className="flex items-center justify-between text-[13px]">
        <button
          type="button"
          onClick={() => {
            setRecovery((v) => !v);
            setValue('');
            setError(null);
          }}
          className="font-medium text-brand-700 hover:underline"
        >
          {recovery ? 'Use a code from my app' : 'Lost your phone? Use a recovery code'}
        </button>
        <button type="button" onClick={() => onRestart('')} className="text-ink-500 hover:text-ink-800">
          Start again
        </button>
      </div>
    </form>
  );
}
