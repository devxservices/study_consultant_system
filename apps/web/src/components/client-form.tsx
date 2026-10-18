'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  ENGLISH_TESTS,
  ENGLISH_TEST_LABEL,
  LEAD_SOURCES,
  LEAD_SOURCE_LABEL,
  QUALIFICATIONS,
  QUALIFICATION_LABEL,
  STUDY_LEVELS,
  STUDY_LEVEL_LABEL,
} from '@crm/shared';
import { Button } from './ui';
import { Field, FormAlert, FormSection, SelectInput, TextArea, TextInput, callApi } from './forms';

export interface ClientFormValues {
  fullName: string;
  email: string;
  phone: string;
  city: string;
  notes: string;
  assignedConsultantId: string;
  targetCountry: string;
  targetUniversity: string;
  targetProgram: string;
  intake: string;
  // profile
  dateOfBirth: string;
  nationality: string;
  passportNumber: string;
  passportExpiry: string;
  highestQualification: string;
  lastInstitution: string;
  lastGrade: string;
  graduationYear: string;
  englishTest: string;
  englishScore: string;
  englishTestDate: string;
  intendedLevel: string;
  intendedField: string;
  preferredCountries: string;
  budget: string;
  leadSource: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
}

const EMPTY: ClientFormValues = {
  fullName: '',
  email: '',
  phone: '',
  city: '',
  notes: '',
  assignedConsultantId: '',
  targetCountry: '',
  targetUniversity: '',
  targetProgram: '',
  intake: '',
  dateOfBirth: '',
  nationality: 'Pakistani',
  passportNumber: '',
  passportExpiry: '',
  highestQualification: '',
  lastInstitution: '',
  lastGrade: '',
  graduationYear: '',
  englishTest: '',
  englishScore: '',
  englishTestDate: '',
  intendedLevel: '',
  intendedField: '',
  preferredCountries: '',
  budget: '',
  leadSource: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
};

const PROFILE_TEXT = [
  'dateOfBirth',
  'nationality',
  'passportNumber',
  'passportExpiry',
  'highestQualification',
  'lastInstitution',
  'lastGrade',
  'englishTest',
  'englishScore',
  'englishTestDate',
  'intendedLevel',
  'intendedField',
  'budget',
  'leadSource',
  'emergencyContactName',
  'emergencyContactPhone',
] as const;

const COUNTRIES = [
  'United Kingdom',
  'United States',
  'Canada',
  'Australia',
  'Germany',
  'Ireland',
  'New Zealand',
  'Italy',
  'France',
  'Turkey',
  'Malaysia',
  'China',
];

/**
 * Used for both adding and editing. Server-side validation messages are keyed
 * by field name and rendered next to the input that caused them.
 *
 * Two cards side by side on a wide screen: who the client is, and the student
 * profile a consultant advises from. Everything in the profile is optional -
 * it fills in over the first few visits.
 */
export function ClientForm({
  mode,
  clientId,
  initial,
  withApplication = true,
  redirectBase = '/desk/clients',
  consultants,
}: {
  mode: 'create' | 'edit';
  clientId?: string;
  initial?: Partial<ClientFormValues>;
  withApplication?: boolean;
  redirectBase?: string;
  /** When passed (manager only), an "assign to" selector is shown. */
  consultants?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<ClientFormValues>({ ...EMPTY, ...initial });
  const [addApplication, setAddApplication] = useState(mode === 'create');
  const [courseOnly, setCourseOnly] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof ClientFormValues) => (v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    setBusy(true);

    // Creating: an empty field is simply not sent. Editing: it is sent as null,
    // which clears whatever was there.
    const blank = mode === 'create' ? undefined : null;
    const payload: Record<string, unknown> = {
      fullName: values.fullName.trim(),
      email: values.email.trim(),
      phone: values.phone.trim(),
      city: values.city.trim() || undefined,
      notes: values.notes.trim() || undefined,
      ...(consultants && values.assignedConsultantId
        ? { assignedConsultantId: values.assignedConsultantId }
        : {}),
    };
    for (const k of PROFILE_TEXT) payload[k] = values[k].trim() || blank;
    payload.graduationYear = values.graduationYear.trim() ? Number(values.graduationYear) : blank;
    const countries = values.preferredCountries.split(',').map((s) => s.trim()).filter(Boolean);
    payload.preferredCountries = countries.length ? countries : blank;

    if (mode === 'create' && courseOnly) payload.programme = 'course_only';
    if (mode === 'create' && withApplication && addApplication && !courseOnly) {
      payload.firstApplication = {
        targetCountry: values.targetCountry.trim(),
        targetUniversity: values.targetUniversity.trim() || undefined,
        targetProgram: values.targetProgram.trim() || undefined,
        intake: values.intake.trim() || undefined,
      };
    }

    const res = await callApi<{ id: string }>(mode === 'create' ? '/api/clients' : `/api/clients/${clientId}`, {
      method: mode === 'create' ? 'POST' : 'PATCH',
      json: payload,
    });
    if (!res.ok) {
      setErrors(res.fieldErrors);
      setFormError(res.message ?? (Object.keys(res.fieldErrors).length ? 'Please check the highlighted fields.' : null));
      setBusy(false);
      return;
    }
    router.push(`${redirectBase}/${res.data?.id ?? clientId}`);
    router.refresh();
  }

  const err = (k: string) => errors[k] ?? errors[`firstApplication.${k}`];

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {formError && <FormAlert>{formError}</FormAlert>}

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <FormSection title="Client details" description="How to reach them, and who looks after them.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required error={err('fullName')} className="sm:col-span-2">
              <TextInput value={values.fullName} onChange={set('fullName')} autoComplete="name" placeholder="e.g. Hamza Khan" invalid={Boolean(err('fullName'))} />
            </Field>
            <Field label="Email address" required error={err('email')}>
              <TextInput type="email" value={values.email} onChange={set('email')} autoComplete="email" placeholder="name@example.com" invalid={Boolean(err('email'))} />
            </Field>
            <Field label="Phone number" required error={err('phone')}>
              <TextInput type="tel" value={values.phone} onChange={set('phone')} autoComplete="tel" placeholder="+92 300 1234567" invalid={Boolean(err('phone'))} />
            </Field>
            <Field label="City" error={err('city')}>
              <TextInput value={values.city} onChange={set('city')} placeholder="Lahore" />
            </Field>
            <Field label="How they found you" error={err('leadSource')}>
              <SelectInput value={values.leadSource} onChange={set('leadSource')} placeholder="Not recorded" options={LEAD_SOURCES.map((s) => ({ value: s, label: LEAD_SOURCE_LABEL[s] }))} />
            </Field>
            {consultants && (
              <Field label="Consultant" hint="Leave unassigned to decide later." error={err('assignedConsultantId')} className="sm:col-span-2">
                <SelectInput value={values.assignedConsultantId} onChange={set('assignedConsultantId')} placeholder="Unassigned" options={consultants.map((c) => ({ value: c.id, label: c.name }))} />
              </Field>
            )}
            <Field label="Emergency contact" error={err('emergencyContactName')}>
              <TextInput value={values.emergencyContactName} onChange={set('emergencyContactName')} placeholder="Parent or guardian" />
            </Field>
            <Field label="Their phone" error={err('emergencyContactPhone')}>
              <TextInput type="tel" value={values.emergencyContactPhone} onChange={set('emergencyContactPhone')} placeholder="+92 300 7654321" />
            </Field>
            <Field label="Internal notes" hint="Only staff can see this." error={err('notes')} className="sm:col-span-2">
              <TextArea value={values.notes} onChange={set('notes')} rows={3} placeholder="Anything the team should know." />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Student profile" description="What you advise from. All optional - fill it in as you learn it.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date of birth" error={err('dateOfBirth')}>
              <TextInput type="date" value={values.dateOfBirth} onChange={set('dateOfBirth')} invalid={Boolean(err('dateOfBirth'))} />
            </Field>
            <Field label="Nationality" error={err('nationality')}>
              <TextInput value={values.nationality} onChange={set('nationality')} />
            </Field>
            <Field label="Passport number" error={err('passportNumber')}>
              <TextInput value={values.passportNumber} onChange={(v) => set('passportNumber')(v.toUpperCase())} placeholder="AB1234567" invalid={Boolean(err('passportNumber'))} />
            </Field>
            <Field label="Passport expiry" hint="Most visas need 6 months’ validity." error={err('passportExpiry')}>
              <TextInput type="date" value={values.passportExpiry} onChange={set('passportExpiry')} invalid={Boolean(err('passportExpiry'))} />
            </Field>
            <Field label="Highest qualification" error={err('highestQualification')}>
              <SelectInput value={values.highestQualification} onChange={set('highestQualification')} placeholder="Not recorded" options={QUALIFICATIONS.map((q) => ({ value: q, label: QUALIFICATION_LABEL[q] }))} />
            </Field>
            <Field label="Grade / CGPA" error={err('lastGrade')}>
              <TextInput value={values.lastGrade} onChange={set('lastGrade')} placeholder="3.2 CGPA or 78%" />
            </Field>
            <Field label="Institution" error={err('lastInstitution')}>
              <TextInput value={values.lastInstitution} onChange={set('lastInstitution')} placeholder="University of the Punjab" />
            </Field>
            <Field label="Year completed" error={err('graduationYear')}>
              <TextInput value={values.graduationYear} onChange={set('graduationYear')} inputMode="numeric" placeholder="2024" invalid={Boolean(err('graduationYear'))} />
            </Field>
            <Field label="English test" error={err('englishTest')}>
              <SelectInput value={values.englishTest} onChange={set('englishTest')} placeholder="Not recorded" options={ENGLISH_TESTS.map((t) => ({ value: t, label: ENGLISH_TEST_LABEL[t] }))} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Score" error={err('englishScore')}>
                <TextInput value={values.englishScore} onChange={set('englishScore')} placeholder="6.5" />
              </Field>
              <Field label="Taken on" error={err('englishTestDate')}>
                <TextInput type="date" value={values.englishTestDate} onChange={set('englishTestDate')} />
              </Field>
            </div>
            <Field label="Wants to study" error={err('intendedLevel')}>
              <SelectInput value={values.intendedLevel} onChange={set('intendedLevel')} placeholder="Not decided" options={STUDY_LEVELS.map((l) => ({ value: l, label: STUDY_LEVEL_LABEL[l] }))} />
            </Field>
            <Field label="Subject" error={err('intendedField')}>
              <TextInput value={values.intendedField} onChange={set('intendedField')} placeholder="Computer Science" />
            </Field>
            <Field label="Preferred countries" hint="Comma-separated" error={err('preferredCountries')}>
              <TextInput value={values.preferredCountries} onChange={set('preferredCountries')} placeholder="United Kingdom, Canada" />
            </Field>
            <Field label="Budget" error={err('budget')}>
              <TextInput value={values.budget} onChange={set('budget')} placeholder="PKR 6-8 million / year" />
            </Field>
          </div>
        </FormSection>
      </div>

      {mode === 'create' && withApplication && (
        <FormSection title="First application" description="Opens a case at the Inquiry stage. You can add more countries later.">
          <div className="mb-3 flex flex-wrap gap-4 text-[14px] text-ink-800">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="radio" name="programme" checked={!courseOnly} onChange={() => setCourseOnly(false)} className="size-4 accent-brand-700" />
              Study abroad
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="radio" name="programme" checked={courseOnly} onChange={() => setCourseOnly(true)} className="size-4 accent-brand-700" />
              A course only (IELTS, spoken English…)
            </label>
          </div>
          {courseOnly ? (
            <p className="text-[13px] text-ink-500">They stay out of the study-abroad pipeline. Enrol them in a batch from Courses; hand them over later if they decide to study abroad.</p>
          ) : (
          <label className="flex cursor-pointer items-center gap-2.5 text-[14px] text-ink-800">
            <input type="checkbox" checked={addApplication} onChange={(e) => setAddApplication(e.target.checked)} className="size-4 accent-brand-700" />
            Start their first application now
          </label>
          )}

          {addApplication && !courseOnly && (
            <div className="mt-4 space-y-4 border-t border-line pt-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Field label="Target country" required error={err('targetCountry')}>
                  <SelectInput
                    value={values.targetCountry}
                    onChange={set('targetCountry')}
                    placeholder="Select a country"
                    options={[...new Set([...COUNTRIES, ...(values.targetCountry ? [values.targetCountry] : [])])].map((c) => ({ value: c, label: c }))}
                    invalid={Boolean(err('targetCountry'))}
                  />
                </Field>
                <Field label="University" error={err('targetUniversity')}>
                  <TextInput value={values.targetUniversity} onChange={set('targetUniversity')} placeholder="Not decided yet" />
                </Field>
                <Field label="Programme" error={err('targetProgram')}>
                  <TextInput value={values.targetProgram} onChange={set('targetProgram')} placeholder="MSc Computer Science" />
                </Field>
                <Field label="Intake" hint='e.g. "Fall 2026"' error={err('intake')}>
                  <TextInput value={values.intake} onChange={set('intake')} placeholder="Fall 2026" invalid={Boolean(err('intake'))} />
                </Field>
              </div>
            </div>
          )}
        </FormSection>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : mode === 'create' ? 'Add client' : 'Save changes'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
