'use client';

import { useState, type FormEvent } from 'react';
import { WEEKDAYS, type PublicCoursesView } from '@crm/shared';
import { Button } from '@/components/ui';
import { callApi, Field, FormAlert, SelectInput, TextArea, TextInput } from '@/components/forms';

export function EnquireForm({ courses, initialCourse }: { courses: PublicCoursesView['courses']; initialCourse: string }) {
  const [f, setF] = useState({ fullName: '', phone: '', email: '', city: '', courseId: courses.some((c) => c.id === initialCourse) ? initialCourse : '', batchId: '', message: '', website: '' });
  const [studyAbroad, setStudyAbroad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v, ...(k === 'courseId' ? { batchId: '' } : {}) }));
  const batches = courses.find((c) => c.id === f.courseId)?.batches ?? [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await callApi('/api/public/courses/enquire', {
      method: 'POST',
      json: { ...f, email: f.email || null, city: f.city || null, courseId: f.courseId || null, batchId: f.batchId || null, message: f.message || null, website: f.website || undefined, studyAbroad },
    });
    setBusy(false);
    if (!res.ok) {
      setFieldErrors(res.fieldErrors);
      setError(res.message ?? 'Please check the highlighted fields.');
      return;
    }
    setDone(true);
  }

  if (done) return <FormAlert tone="ok">Thank you - we have your details and will call you back soon.</FormAlert>;

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your name" required error={fieldErrors.fullName}>
          <TextInput value={f.fullName} onChange={set('fullName')} autoComplete="name" invalid={Boolean(fieldErrors.fullName)} />
        </Field>
        <Field label="Phone" required error={fieldErrors.phone}>
          <TextInput value={f.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" invalid={Boolean(fieldErrors.phone)} />
        </Field>
        <Field label="Email" error={fieldErrors.email}>
          <TextInput value={f.email} onChange={set('email')} inputMode="email" autoComplete="email" invalid={Boolean(fieldErrors.email)} />
        </Field>
        <Field label="City">
          <TextInput value={f.city} onChange={set('city')} />
        </Field>
        <Field label="Course" error={fieldErrors.courseId}>
          <SelectInput value={f.courseId} onChange={set('courseId')} placeholder="Not sure yet" options={courses.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        {batches.length > 0 && (
          <Field label="Batch">
            <SelectInput
              value={f.batchId}
              onChange={set('batchId')}
              placeholder="Any"
              options={batches.map((b) => ({ value: b.id, label: `Starts ${b.startDate} · ${b.days.map((d) => WEEKDAYS[d]).join('/')} ${b.startTime}-${b.endTime}${b.seatsLeft === 0 ? ' · full' : ''}` }))}
            />
          </Field>
        )}
      </div>
      <label className="flex items-center gap-2 text-[13.5px] text-ink-800">
        <input type="checkbox" checked={studyAbroad} onChange={(e) => setStudyAbroad(e.target.checked)} /> I am also interested in studying abroad
      </label>
      <Field label="Anything you would like to ask">
        <TextArea value={f.message} onChange={set('message')} rows={3} />
      </Field>
      {/* Left empty by people; filled by bots. */}
      <div aria-hidden className="absolute left-[-9999px]">
        <label>
          Website <input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set('website')(e.target.value)} />
        </label>
      </div>
      {error && <FormAlert>{error}</FormAlert>}
      <Button type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Send'}
      </Button>
    </form>
  );
}
