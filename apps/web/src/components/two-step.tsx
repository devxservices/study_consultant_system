'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { MfaSetup, MfaStatus } from '@crm/shared';
import { Button, Pill, cx } from './ui';
import { callApi, Field, FormAlert, FormSection, TextInput } from './forms';
import { IconCheck, IconKey } from './icons';

/* ------------------------------------------------------------------ */
/* Enrolment                                                           */
/* ------------------------------------------------------------------ */

/**
 * Switching two-step verification on, in three steps: scan the QR code,
 * prove it worked by typing a code from the app, then keep the recovery
 * codes. Nothing is switched on until the code checks out, so a scan that
 * went wrong cannot lock anyone out.
 */
export function TwoStepSetup({
  doneHref,
  onCancel,
  onEnabled,
}: {
  doneHref?: string;
  onCancel?: () => void;
  /** Told the moment it is on, while the recovery codes are still on screen. */
  onEnabled?: () => void;
}) {
  const router = useRouter();
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    const res = await callApi<MfaSetup>('/api/auth/mfa/setup', { method: 'POST' });
    setBusy(false);
    if (!res.ok || !res.data) {
      setError(res.message ?? 'Could not start the set-up. Try again.');
      return;
    }
    setSetup(res.data);
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await callApi<{ recoveryCodes: string[] }>('/api/auth/mfa/enable', { method: 'POST', json: { code } });
    setBusy(false);
    if (!res.ok || !res.data) {
      setError(res.fieldErrors.code ?? res.message ?? 'That code did not match.');
      return;
    }
    setCodes(res.data.recoveryCodes);
    onEnabled?.();
  }

  function finish() {
    if (doneHref) {
      // A full load: the session's "set-up required" flag has just changed.
      window.location.href = doneHref;
    } else {
      router.refresh();
    }
  }

  if (codes) {
    return (
      <div className="space-y-4">
        <FormAlert tone="ok">Two-step verification is on. From now on you will be asked for a code after your password.</FormAlert>
        <RecoveryCodes codes={codes} />
        <Button onClick={finish}>I have saved my recovery codes</Button>
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="space-y-4">
        <ol className="space-y-2 text-[13.5px] text-ink-600">
          <Step n={1}>
            Install an authenticator app on your phone - Google Authenticator, Microsoft Authenticator, 1Password or
            similar.
          </Step>
          <Step n={2}>Scan the QR code we show you with it.</Step>
          <Step n={3}>Type the 6-digit code the app shows, to prove it worked.</Step>
        </ol>
        {error && <FormAlert>{error}</FormAlert>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={start} disabled={busy}>
            {busy ? 'Starting…' : 'Set up two-step verification'}
          </Button>
          {onCancel && (
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Not now
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL generated for this person, never cached */}
        <img
          src={setup.qrDataUrl}
          alt="QR code to scan with your authenticator app"
          width={220}
          height={220}
          className="rounded-lg border border-line bg-white p-2"
        />
        <button
          type="button"
          onClick={() => setShowKey((v) => !v)}
          className="mt-2 text-[12.5px] font-medium text-brand-700 hover:underline"
        >
          {showKey ? 'Hide the key' : 'Can’t scan it? Type a key instead'}
        </button>
        {showKey && (
          <p className="mt-1.5 break-all rounded-md bg-ink-50 px-2.5 py-2 font-mono text-[12.5px] tracking-wider text-ink-800">
            {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
          </p>
        )}
      </div>

      <form onSubmit={confirm} noValidate className="space-y-4">
        <p className="text-[13.5px] leading-relaxed text-ink-600">
          Scan the code with your authenticator app. It adds an entry that shows a new 6-digit code every 30 seconds.
          Type the one it shows now.
        </p>
        {error && <FormAlert>{error}</FormAlert>}
        <Field label="Code from the app" htmlFor="mfa-code">
          <input
            id="mfa-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, '').slice(0, 7))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123 456"
            className="h-11 w-44 rounded-md border border-line-strong bg-paper px-3 text-center font-mono text-[20px] tracking-[0.25em] text-ink-950 placeholder:text-ink-300 focus:border-brand-500"
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || code.replace(/\s/g, '').length !== 6}>
            {busy ? 'Checking…' : 'Turn on'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSetup(null);
              setCode('');
              onCancel?.();
            }}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="flex size-5.5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[11.5px] font-semibold text-white">
        {n}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}

/** Shown once. Copy, download or print them - they are the way back in without the phone. */
export function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');
  return (
    <div className="rounded-xl border border-warn-200 bg-warn-50/60 p-4">
      <p className="text-[14px] font-semibold text-ink-950">Your recovery codes</p>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-600">
        If you lose your phone, each of these gets you in once. Keep them somewhere safe and away from your phone -
        they will not be shown again.
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg bg-paper p-3 font-mono text-[14px] tracking-wider text-ink-900 sm:grid-cols-2">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? (
            <>
              <IconCheck size={14} /> Copied
            </>
          ) : (
            'Copy'
          )}
        </Button>
        <a
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(`Recovery codes - each works once\n\n${text}\n`)}`}
          download="recovery-codes.txt"
          className="inline-flex h-8 items-center rounded-lg border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink-800 hover:bg-ink-50"
        >
          Download
        </a>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The account card                                                    */
/* ------------------------------------------------------------------ */

/** The signed-in person's own two-step verification: set it up, renew codes, or switch it off. */
export function TwoStepCard({ status }: { status: MfaStatus }) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'setup' | 'regenerate' | 'disable'>('idle');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justOn, setJustOn] = useState(false);
  const on = status.enabled || justOn;

  async function withCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const url = mode === 'regenerate' ? '/api/auth/mfa/recovery-codes' : '/api/auth/mfa/disable';
    const res = await callApi<{ recoveryCodes: string[] }>(url, { method: 'POST', json: { code } });
    setBusy(false);
    if (!res.ok) {
      setError(res.fieldErrors.code ?? res.message ?? 'That code did not match.');
      return;
    }
    setCode('');
    if (mode === 'regenerate' && res.data) {
      setCodes(res.data.recoveryCodes);
    } else {
      setMode('idle');
      router.refresh();
    }
  }

  return (
    <FormSection
      title="Two-step verification"
      description="A code from an app on your phone after your password, so a stolen password alone is not enough."
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {on ? (
          <Pill tone="ok" dot>
            On
          </Pill>
        ) : (
          <Pill tone="warn" dot>
            Off
          </Pill>
        )}
        {status.required && <Pill tone="info">Required by your consultancy</Pill>}
        {status.enabled && (
          <span className={cx('text-[12.5px]', status.recoveryCodesLeft <= 2 ? 'font-medium text-bad-700' : 'text-ink-500')}>
            {status.recoveryCodesLeft} recovery {status.recoveryCodesLeft === 1 ? 'code' : 'codes'} left
          </span>
        )}
      </div>

      {codes ? (
        <div className="space-y-3">
          <RecoveryCodes codes={codes} />
          <Button
            size="sm"
            onClick={() => {
              setCodes(null);
              setMode('idle');
              router.refresh();
            }}
          >
            Done
          </Button>
        </div>
      ) : !status.enabled ? (
        mode === 'setup' ? (
          <TwoStepSetup onCancel={() => setMode('idle')} onEnabled={() => setJustOn(true)} />
        ) : (
          <Button onClick={() => setMode('setup')}>
            <IconKey size={16} /> Set up two-step verification
          </Button>
        )
      ) : mode === 'idle' ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setMode('regenerate')}>
            New recovery codes
          </Button>
          {!status.required && (
            <Button variant="ghost" size="sm" onClick={() => setMode('disable')}>
              Turn off
            </Button>
          )}
        </div>
      ) : (
        <form onSubmit={withCode} noValidate className="max-w-md space-y-3">
          <p className="text-[13px] text-ink-600">
            {mode === 'regenerate'
              ? 'Your old recovery codes stop working and ten new ones are made. Enter a code from your app to confirm.'
              : 'Your account will be protected by your password alone. Enter a code from your app to confirm.'}
          </p>
          {error && <FormAlert>{error}</FormAlert>}
          <Field label="Code from the app">
            <TextInput value={code} onChange={setCode} inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant={mode === 'disable' ? 'danger' : 'primary'} disabled={busy || code.replace(/\s/g, '').length !== 6}>
              {busy ? 'Checking…' : mode === 'regenerate' ? 'Make new codes' : 'Turn off'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setMode('idle');
                setError(null);
                setCode('');
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </FormSection>
  );
}
