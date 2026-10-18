'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { normaliseCountry, type CountryView, type WorkflowSummaryView } from '@crm/shared';
import { Button } from './ui';
import { callApi, Field, FormAlert, FormSection, SelectInput, TextInput } from './forms';

const COUNTRIES = [
  'United Kingdom', 'United States', 'Canada', 'Australia', 'Germany', 'Ireland',
  'New Zealand', 'Italy', 'France', 'Turkey', 'Malaysia', 'China',
];

/** Which workflow the server will pick: the same rule, so the form can say so. */
function bestWorkflow(workflows: WorkflowSummaryView[], v: { country: string; level: string; visa: string }) {
  const norm = (x: string | null | undefined) => (x ?? '').trim().toLowerCase();
  let best: { w: WorkflowSummaryView; score: number } | null = null;
  for (const w of workflows) {
    if (!w.current || w.archived) continue;
    let score = 0;
    if (w.country) {
      if (normaliseCountry(w.country) !== normaliseCountry(v.country)) continue;
      score += 4;
    }
    if (w.studyLevel) {
      if (norm(w.studyLevel) !== norm(v.level)) continue;
      score += 2;
    }
    if (w.visaType) {
      if (norm(w.visaType) !== norm(v.visa)) continue;
      score += 1;
    }
    if (w.isDefault) score -= 1;
    if (!best || score > best.score) best = { w, score };
  }
  return best?.w ?? null;
}

/**
 * Opens an additional application for an existing client. It runs on the
 * workflow for its country (or one chosen here), starts at that workflow's
 * first stage and tracks independently of their other applications.
 */
export function CaseForm({
  clientId,
  base,
  workflows = [],
  countries = [],
}: {
  clientId: string;
  base: '/desk' | '/overview';
  workflows?: WorkflowSummaryView[];
  /** The consultancy's destinations, from its country list. */
  countries?: CountryView[];
}) {
  const router = useRouter();
  const [values, setValues] = useState({
    targetCountry: '',
    targetUniversity: '',
    targetProgram: '',
    studyLevel: '',
    visaType: '',
    intake: '',
    applicationDeadline: '',
    workflowId: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof values) => (v: string) => setValues((p) => ({ ...p, [k]: v }));
  const country = countries.find((c) => normaliseCountry(c.name) === normaliseCountry(values.targetCountry)) ?? null;
  const auto = bestWorkflow(workflows, { country: values.targetCountry, level: values.studyLevel, visa: values.visaType });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    setBusy(true);
    const res = await callApi<{ id: string }>('/api/cases', {
      method: 'POST',
      json: {
        clientId,
        targetCountry: values.targetCountry.trim(),
        targetUniversity: values.targetUniversity.trim() || undefined,
        targetProgram: values.targetProgram.trim() || undefined,
        studyLevel: values.studyLevel.trim() || undefined,
        visaType: values.visaType.trim() || undefined,
        intake: values.intake.trim() || undefined,
        applicationDeadline: values.applicationDeadline || undefined,
        workflowId: values.workflowId || undefined,
      },
    });
    if (!res.ok) {
      setErrors(res.fieldErrors);
      setFormError(res.message);
      setBusy(false);
      return;
    }
    router.push(res.data?.id ? `${base}/cases/${res.data.id}` : `${base}/clients/${clientId}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {formError && <FormAlert>{formError}</FormAlert>}

      <FormSection title="Where to">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Field label="Target country" required error={errors.targetCountry}>
            <SelectInput
              value={values.targetCountry}
              onChange={set('targetCountry')}
              placeholder="Select a country"
              options={[...new Set([...countries.filter((c) => c.active).map((c) => c.name), ...COUNTRIES, ...(values.targetCountry ? [values.targetCountry] : [])])].map((c) => ({ value: c, label: c }))}
              invalid={Boolean(errors.targetCountry)}
            />
          </Field>
          <Field label="University" error={errors.targetUniversity}>
            <TextInput value={values.targetUniversity} onChange={set('targetUniversity')} placeholder="Not decided yet" />
          </Field>
          <Field label="Programme" error={errors.targetProgram}>
            <TextInput value={values.targetProgram} onChange={set('targetProgram')} placeholder="MSc Computer Science" />
          </Field>
          <Field label="Study level" hint="Picks the right document checklist" error={errors.studyLevel}>
            <TextInput value={values.studyLevel} onChange={set('studyLevel')} placeholder="Master's" />
          </Field>
          <Field label="Visa type" error={errors.visaType}>
            <input
              list="visa-types"
              value={values.visaType}
              onChange={(e) => set('visaType')(e.target.value)}
              placeholder={country?.visaTypes[0] ?? 'Student visa'}
              className="h-10 w-full min-w-0 rounded-lg border border-line-strong bg-paper px-3 text-[14px] text-ink-900 placeholder:text-ink-300 focus:border-brand-500 focus:outline-none"
            />
            <datalist id="visa-types">
              {(country?.visaTypes ?? []).map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>
          <Field label="Intake" hint='e.g. "Fall 2026"' error={errors.intake}>
            <TextInput value={values.intake} onChange={set('intake')} placeholder="Fall 2026" invalid={Boolean(errors.intake)} />
          </Field>
          <Field label="Application deadline" error={errors.applicationDeadline}>
            <TextInput type="date" value={values.applicationDeadline} onChange={set('applicationDeadline')} />
          </Field>
        </div>
      </FormSection>

      {workflows.length > 0 && (
        <FormSection title="Workflow" description="The stages this application goes through. Chosen from its country, level and visa type unless you pick one.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Run it on" error={errors.workflowId}>
              <SelectInput
                value={values.workflowId}
                onChange={set('workflowId')}
                placeholder={auto ? `Automatic: ${auto.name}` : 'Automatic'}
                options={workflows
                  .filter((w) => w.current && !w.archived)
                  .map((w) => ({ value: w.id, label: `${w.name}${w.country ? ` (${w.country})` : ''}` }))}
              />
            </Field>
            {country && (
              <div className="rounded-lg bg-ink-50 px-3 py-2 text-[12.5px] text-ink-600">
                <p className="font-medium text-ink-800">
                  {country.flag} {country.name}
                </p>
                {country.intakes.length > 0 && <p>Intakes: {country.intakes.map((i) => i.name).join(', ')}</p>}
                {country.languageRequirements[0] && (
                  <p>
                    {country.languageRequirements[0].test} {country.languageRequirements[0].overall}
                    {country.languageRequirements[0].minimumBand ? ` (no band below ${country.languageRequirements[0].minimumBand})` : ''}
                  </p>
                )}
                {country.visaProcessingDays !== null && <p>Visa decisions in about {country.visaProcessingDays} days</p>}
              </div>
            )}
          </div>
        </FormSection>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy || !values.targetCountry}>
          {busy ? 'Opening…' : 'Open application'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
