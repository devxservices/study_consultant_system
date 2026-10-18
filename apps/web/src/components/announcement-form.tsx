'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AUDIENCES, AUDIENCE_LABEL } from '@crm/shared';
import { Button } from './ui';
import { callApi, Field, FormAlert, SelectInput, TextArea, TextInput } from './forms';

/** Publishing a notice. Everyone it is for also gets it once in their bell. */
export function AnnouncementForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('everyone');
  const [pinned, setPinned] = useState(false);
  const [expiresOn, setExpiresOn] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    const res = await callApi('/api/announcements', {
      method: 'POST',
      json: { title: title.trim(), body: body.trim(), audience, pinned, expiresOn: expiresOn || undefined },
    });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors);
      setError(res.message);
      return;
    }
    setTitle('');
    setBody('');
    setPinned(false);
    setExpiresOn('');
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {error && <FormAlert>{error}</FormAlert>}
      <Field label="Headline" required error={errors.title}>
        <TextInput value={title} onChange={setTitle} placeholder="e.g. Office closed on Friday" invalid={Boolean(errors.title)} />
      </Field>
      <Field label="Message" required error={errors.body}>
        <TextArea value={body} onChange={setBody} rows={5} invalid={Boolean(errors.body)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Who sees it">
          <SelectInput value={audience} onChange={setAudience} options={AUDIENCES.map((a) => ({ value: a, label: AUDIENCE_LABEL[a] }))} />
        </Field>
        <Field label="Show until" hint="Optional">
          <TextInput type="date" value={expiresOn} onChange={setExpiresOn} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-[13.5px] text-ink-700">
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="size-4 accent-brand-700" />
        Pin it to the top
      </label>
      <Button type="submit" disabled={busy}>
        {busy ? 'Publishing…' : 'Publish'}
      </Button>
    </form>
  );
}
