'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PlatformSettingsView } from '@crm/shared';
import { Button, Card } from '../ui';
import { callApi, Field, FormAlert, TextArea, TextInput } from '../forms';
import { PRIVACY_TEMPLATE, TERMS_TEMPLATE } from './legal-templates';

type Note = { tone: 'ok' | 'bad'; text: string } | null;

/** How consultancies pay the platform: the instructions managers see, the grace days, the trial. */
export function BillingSettingsForm({ settings }: { settings: PlatformSettingsView['billing'] }) {
  const router = useRouter();
  const [instructions, setInstructions] = useState(settings.paymentInstructions);
  const [grace, setGrace] = useState(String(settings.graceDays));
  const [trial, setTrial] = useState(String(settings.trialDays));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    const res = await callApi('/api/admin/platform/settings/billing', {
      method: 'PUT',
      json: { paymentInstructions: instructions, graceDays: grace, trialDays: trial },
    });
    setBusy(false);
    setErrors(res.fieldErrors);
    setNote(res.ok ? { tone: 'ok', text: 'Saved. Managers see the new instructions at once.' } : res.message ? { tone: 'bad', text: res.message } : null);
    if (res.ok) router.refresh();
  }

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold text-ink-950">How consultancies pay you</h2>
      <p className="mt-0.5 text-[12.5px] text-ink-400">Shown on each manager’s Subscription page and in renewal reminders.</p>
      <form onSubmit={save} className="mt-4 space-y-4">
        <Field label="Payment instructions" error={errors.paymentInstructions} hint="Bank account and IBAN, wallet number, who to send the slip to.">
          <TextArea value={instructions} onChange={setInstructions} rows={5} placeholder={'Bank transfer to Your Company Ltd\nMeezan Bank, IBAN PK00 MEZN 0000 0000 0000\nSend the slip to billing@yourcrm.com'} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Grace days" error={errors.graceDays} hint="After the paid-until date, before records become read-only.">
            <TextInput value={grace} onChange={setGrace} inputMode="numeric" invalid={Boolean(errors.graceDays)} />
          </Field>
          <Field label="Free trial for new consultancies (days)" error={errors.trialDays} hint="0 leaves new consultancies without an end date.">
            <TextInput value={trial} onChange={setTrial} inputMode="numeric" invalid={Boolean(errors.trialDays)} />
          </Field>
        </div>
        {note && <FormAlert tone={note.tone}>{note.text}</FormAlert>}
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </Card>
  );
}

/** The platform's terms of service and privacy policy, published at /terms and /privacy. */
export function LegalSettingsForm({ settings }: { settings: PlatformSettingsView['legal'] }) {
  const router = useRouter();
  const [operator, setOperator] = useState(settings.operatorName);
  const [terms, setTerms] = useState(settings.terms);
  const [privacy, setPrivacy] = useState(settings.privacy);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if ((terms + privacy).includes('[')) {
      const ok = window.confirm('Some [brackets] from the template are still there. Publish anyway?');
      if (!ok) return;
    }
    setBusy(true);
    setNote(null);
    const res = await callApi('/api/admin/platform/settings/legal', { method: 'PUT', json: { operatorName: operator, terms, privacy } });
    setBusy(false);
    setErrors(res.fieldErrors);
    setNote(
      res.ok
        ? { tone: 'ok', text: terms && privacy ? 'Published. Every sign-in page and public form now links to them.' : 'Saved. A document left empty is not published or linked.' }
        : res.message
          ? { tone: 'bad', text: res.message }
          : null,
    );
    if (res.ok) router.refresh();
  }

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold text-ink-950">Terms and privacy policy</h2>
      <p className="mt-0.5 text-[12.5px] text-ink-400">
        Published at /terms and /privacy on every address, and linked from every sign-in page and public form. Students’ passports and documents
        are personal data: have both checked for the countries you work in.
      </p>
      <form onSubmit={save} className="mt-4 space-y-4">
        <Field label="Your business name" error={errors.operatorName} hint="As it should appear in the documents and in renewal emails.">
          <TextInput value={operator} onChange={setOperator} placeholder="e.g. Acme Software (Pvt) Ltd" />
        </Field>
        <LegalText label="Terms of service" value={terms} onChange={setTerms} template={TERMS_TEMPLATE} error={errors.terms} />
        <LegalText label="Privacy policy" value={privacy} onChange={setPrivacy} template={PRIVACY_TEMPLATE} error={errors.privacy} />
        <p className="text-[12px] text-ink-400">Lines starting with # or ## become headings, lines starting with - become a list. Everything else is shown as written.</p>
        {note && <FormAlert tone={note.tone}>{note.text}</FormAlert>}
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Saving…' : 'Save and publish'}
        </Button>
      </form>
    </Card>
  );
}

function LegalText({
  label,
  value,
  onChange,
  template,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  template: string;
  error?: string;
}) {
  return (
    <Field
      label={label}
      error={error}
      hint={
        value ? undefined : (
          <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => onChange(template.replace('[date]', new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })))}>
            Start from a template (fill in every [bracket] and have it checked - it is not legal advice)
          </button>
        )
      }
    >
      <TextArea value={value} onChange={onChange} rows={value ? 14 : 3} placeholder={`Your ${label.toLowerCase()}, or start from the template below.`} />
    </Field>
  );
}
