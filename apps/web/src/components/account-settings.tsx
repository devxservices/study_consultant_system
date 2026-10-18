'use client';

import { useState, type FormEvent } from 'react';
import { Button } from './ui';
import { callApi, Field, FormAlert, FormSection, TextInput } from './forms';

/** Changing your own password - proving you know the current one first. */
export function ChangePasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setMessage(null);
    if (next !== confirm) {
      setErrors({ confirm: 'The two new passwords are different.' });
      return;
    }
    setBusy(true);
    const res = await callApi('/api/auth/password', {
      method: 'POST',
      json: { currentPassword: current, newPassword: next },
    });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors);
      if (res.message) setMessage({ tone: 'bad', text: res.message });
      return;
    }
    setCurrent('');
    setNext('');
    setConfirm('');
    setMessage({ tone: 'ok', text: 'Password changed. You stay signed in here; any other phone or computer was signed out.' });
  }

  return (
    <FormSection title="Password" description="At least 8 characters. A short sentence is easier to remember and harder to guess.">
      <form onSubmit={submit} noValidate className="max-w-md space-y-4">
        {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}
        <Field label="Current password" error={errors.currentPassword}>
          <TextInput type="password" value={current} onChange={setCurrent} autoComplete="current-password" invalid={Boolean(errors.currentPassword)} />
        </Field>
        <Field label="New password" error={errors.newPassword}>
          <TextInput type="password" value={next} onChange={setNext} autoComplete="new-password" invalid={Boolean(errors.newPassword)} />
        </Field>
        <Field label="New password again" error={errors.confirm}>
          <TextInput type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={Boolean(errors.confirm)} />
        </Field>
        <Button type="submit" disabled={busy || !current || next.length < 8}>
          {busy ? 'Saving…' : 'Change password'}
        </Button>
      </form>
    </FormSection>
  );
}

/**
 * For a lost phone or a shared computer someone forgot to sign out of: every
 * other session ends at once. This one carries on.
 */
export function SignOutEverywhere() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  async function run() {
    if (!confirm('Sign out on every other phone and computer? You stay signed in here.')) return;
    setBusy(true);
    setMessage(null);
    const res = await callApi('/api/auth/sessions/end-others', { method: 'POST' });
    setBusy(false);
    setMessage(
      res.ok
        ? { tone: 'ok', text: 'Done. Everywhere else is signed out; you are still signed in here.' }
        : { tone: 'bad', text: res.message ?? 'That did not work. Please try again.' },
    );
  }

  return (
    <FormSection
      title="Signed-in devices"
      description="Lost a phone, or signed in on a shared computer? Sign out everywhere else. Changing your password does this too."
    >
      <div className="max-w-md space-y-3">
        {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}
        <Button variant="secondary" onClick={run} disabled={busy}>
          {busy ? 'Signing out…' : 'Sign out everywhere else'}
        </Button>
      </div>
    </FormSection>
  );
}
