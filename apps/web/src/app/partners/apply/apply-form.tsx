'use client';

import { useState, type FormEvent } from 'react';
import { PARTNER_KIND_HINT, PARTNER_KIND_LABEL, PARTNER_KINDS } from '@crm/shared';
import { Button } from '@/components/ui';
import { callApi, Field, FormAlert, SelectInput, TextArea, TextInput } from '@/components/forms';

export function ApplyForm() {
  const [f, setF] = useState({ name: '', kind: 'sub_agent', contactName: '', email: '', phone: '', country: 'Pakistan', city: '', website: '', studentsPerYear: '', message: '', website2: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await callApi('/api/public/partners/apply', {
      method: 'POST',
      json: { ...f, city: f.city || null, website: f.website || null, message: f.message || null, studentsPerYear: f.studentsPerYear ? Number(f.studentsPerYear) : null, website2: f.website2 || undefined },
    });
    setBusy(false);
    if (!res.ok) {
      setFieldErrors(res.fieldErrors);
      setError(res.message ?? 'Please check the highlighted fields.');
      return;
    }
    setDone(true);
  }

  if (done) {
    return <FormAlert tone="ok">Thank you - your application is in. We have emailed you a copy and will be in touch about the next steps.</FormAlert>;
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Organisation" error={fieldErrors.name}>
          <TextInput value={f.name} onChange={set('name')} />
        </Field>
        <Field label="What you do" hint={PARTNER_KIND_HINT[f.kind as keyof typeof PARTNER_KIND_HINT]}>
          <SelectInput value={f.kind} onChange={set('kind')} options={PARTNER_KINDS.map((k) => ({ value: k, label: PARTNER_KIND_LABEL[k] }))} />
        </Field>
        <Field label="Your name" error={fieldErrors.contactName}>
          <TextInput value={f.contactName} onChange={set('contactName')} />
        </Field>
        <Field label="Email" error={fieldErrors.email}>
          <TextInput type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Phone" error={fieldErrors.phone}>
          <TextInput value={f.phone} onChange={set('phone')} />
        </Field>
        <Field label="Website">
          <TextInput value={f.website} onChange={set('website')} />
        </Field>
        <Field label="Country" error={fieldErrors.country}>
          <TextInput value={f.country} onChange={set('country')} />
        </Field>
        <Field label="City">
          <TextInput value={f.city} onChange={set('city')} />
        </Field>
        <Field label="Students you send abroad a year">
          <TextInput value={f.studentsPerYear} onChange={(v) => set('studentsPerYear')(v.replace(/\D/g, ''))} inputMode="numeric" />
        </Field>
      </div>
      <Field label="Anything else we should know">
        <TextArea value={f.message} onChange={set('message')} rows={4} />
      </Field>
      {/* Hidden from people; bots fill it in. */}
      <div aria-hidden className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
        <label>
          Leave empty
          <input tabIndex={-1} autoComplete="off" value={f.website2} onChange={(e) => set('website2')(e.target.value)} />
        </label>
      </div>
      {error && <FormAlert>{error}</FormAlert>}
      <Button type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Apply'}
      </Button>
    </form>
  );
}
