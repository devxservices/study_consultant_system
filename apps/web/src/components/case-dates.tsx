'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { OFFER_TYPES, OFFER_TYPE_LABEL, type OfferType } from '@crm/shared';
import { Button, Card, Pill, cx } from './ui';
import { callApi, Field, SelectInput, TextArea, TextInput } from './forms';

export interface CaseDates {
  studyLevel?: string | null;
  visaType?: string | null;
  intake: string | null;
  applicationDeadline: string | null;
  offerType: OfferType | null;
  offerConditions: string | null;
  offerDeadline: string | null;
  visaAppointmentAt: string | null;
  travelDate: string | null;
}

/** "in 12 days", "tomorrow", "3 days ago". */
function countdown(date: string): { text: string; tone: 'bad' | 'warn' | 'neutral' } {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(new Date(date.length === 10 ? `${date}T00:00:00` : date)) - start(new Date())) / 86_400_000);
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} ago`, tone: 'bad' };
  if (days === 0) return { text: 'today', tone: 'warn' };
  if (days === 1) return { text: 'tomorrow', tone: 'warn' };
  return { text: `in ${days} days`, tone: days <= 7 ? 'warn' : 'neutral' };
}

function show(date: string | null, withTime = false): string {
  if (!date) return '';
  const d = new Date(date.length === 10 ? `${date}T00:00:00` : date);
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit', hour12: true } : {}),
  });
}

/** "2027-01-15T10:30" for a datetime-local input, from an ISO timestamp. */
function localInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The dates the whole case runs on, with a countdown to each. These are what
 * feed the upcoming-deadlines lists on the dashboards, so they are worth the
 * ten seconds it takes to fill them in.
 */
export function CaseDatesCard({
  caseId,
  dates,
  canEdit,
}: {
  caseId: string;
  dates: CaseDates;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({
    studyLevel: dates.studyLevel ?? '',
    visaType: dates.visaType ?? '',
    intake: dates.intake ?? '',
    applicationDeadline: dates.applicationDeadline ?? '',
    offerType: dates.offerType ?? '',
    offerConditions: dates.offerConditions ?? '',
    offerDeadline: dates.offerDeadline ?? '',
    visaAppointmentAt: localInput(dates.visaAppointmentAt),
    travelDate: dates.travelDate ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (value: string) => setV((p) => ({ ...p, [k]: value }));

  async function save() {
    setBusy(true);
    setErrors({});
    setError(null);
    const res = await callApi(`/api/cases/${caseId}`, {
      method: 'PATCH',
      json: {
        studyLevel: v.studyLevel.trim() || null,
        visaType: v.visaType.trim() || null,
        intake: v.intake.trim() || null,
        applicationDeadline: v.applicationDeadline || null,
        offerType: v.offerType || null,
        offerConditions: v.offerConditions.trim() || null,
        offerDeadline: v.offerDeadline || null,
        visaAppointmentAt: v.visaAppointmentAt ? new Date(v.visaAppointmentAt).toISOString() : null,
        travelDate: v.travelDate || null,
      },
    });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors);
      setError(res.message);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  const rows: [string, string | null, boolean][] = [
    ['Application deadline', dates.applicationDeadline, false],
    ['Offer deadline', dates.offerDeadline, false],
    ['Visa appointment', dates.visaAppointmentAt, true],
    ['Travel', dates.travelDate, false],
  ];

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[15.5px] font-medium text-ink-950">Key dates</h2>
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-[12.5px] font-medium text-brand-700 hover:underline">
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Study level" error={errors.studyLevel}>
              <TextInput value={v.studyLevel} onChange={set('studyLevel')} placeholder="Master's" />
            </Field>
            <Field label="Visa type" error={errors.visaType}>
              <TextInput value={v.visaType} onChange={set('visaType')} placeholder="Student visa" />
            </Field>
            <Field label="Intake" error={errors.intake}>
              <TextInput value={v.intake} onChange={set('intake')} placeholder="Fall 2026" invalid={Boolean(errors.intake)} />
            </Field>
            <Field label="Apply by" error={errors.applicationDeadline}>
              <TextInput type="date" value={v.applicationDeadline} onChange={set('applicationDeadline')} />
            </Field>
            <Field label="Offer" error={errors.offerType}>
              <SelectInput value={v.offerType} onChange={set('offerType')} placeholder="None yet" options={OFFER_TYPES.map((t) => ({ value: t, label: OFFER_TYPE_LABEL[t] }))} />
            </Field>
            <Field label="Accept offer by" error={errors.offerDeadline}>
              <TextInput type="date" value={v.offerDeadline} onChange={set('offerDeadline')} />
            </Field>
          </div>
          {v.offerType === 'conditional' && (
            <Field label="Offer conditions" error={errors.offerConditions}>
              <TextArea value={v.offerConditions} onChange={set('offerConditions')} rows={2} placeholder="What the student still has to show" />
            </Field>
          )}
          <Field label="Visa appointment" error={errors.visaAppointmentAt}>
            <input
              type="datetime-local"
              value={v.visaAppointmentAt}
              onChange={(e) => set('visaAppointmentAt')(e.target.value)}
              className="h-10 w-full rounded-md border border-line-strong bg-paper px-3 text-[14px] text-ink-900"
            />
          </Field>
          <Field label="Travel date" error={errors.travelDate}>
            <TextInput type="date" value={v.travelDate} onChange={set('travelDate')} />
          </Field>
          {error && <p className="text-[12px] text-bad-700">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save dates'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <dl className="space-y-2.5 text-[13px]">
            {rows.map(([label, date, withTime]) => {
              const c = date ? countdown(date) : null;
              return (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 text-ink-400">{label}</dt>
                  <dd className="min-w-0 text-right">
                    {date ? (
                      <>
                        <span className="font-medium text-ink-800">{show(date, withTime)}</span>
                        <span className={cx('ml-1.5 text-[12px]', c!.tone === 'bad' ? 'text-bad-700' : c!.tone === 'warn' ? 'text-warn-700' : 'text-ink-400')}>
                          {c!.text}
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-300">—</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
          {dates.offerType && (
            <div className="mt-3 border-t border-line pt-3">
              <Pill tone={dates.offerType === 'unconditional' ? 'ok' : 'warn'} dot>
                {OFFER_TYPE_LABEL[dates.offerType]}
              </Pill>
              {dates.offerConditions && <p className="mt-2 text-[12.5px] leading-relaxed text-ink-600">{dates.offerConditions}</p>}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
