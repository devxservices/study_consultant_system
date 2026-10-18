'use client';

import { useState } from 'react';
import {
  localIsoDateIn,
  localIsoDate,
  ENQUIRY_SOURCE_LABEL,
  ENQUIRY_SOURCES,
  LOST_REASONS,
  WEEKDAYS,
  type BatchSummaryView,
  type EnquiryView,
  type EnrollmentView,
  type TrialSlotView,
} from '@crm/shared';
import { Button, cx } from '../ui';
import { Field, FormAlert, SelectInput, TextArea, TextInput } from '../forms';
import { usePost } from '../use-post';
import { BatchChecklist, BillingFields } from './course-forms';

type Option = { id: string; name: string };
const today = () => localIsoDate();
const addDays = (n: number) => localIsoDateIn(n);
const weekday = (d: string) => WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()];

/* ------------------------------------------------------------------ */
/* Taking an enquiry, or editing it                                     */
/* ------------------------------------------------------------------ */

export function EnquiryForm({
  initial,
  base,
  courses,
  batches,
  staff,
  me,
}: {
  initial: EnquiryView | null;
  base: string;
  courses: Option[];
  batches: BatchSummaryView[];
  staff: Option[];
  me: string;
}) {
  const { busy, error, fieldErrors, post } = usePost();
  const [f, setF] = useState({
    fullName: initial?.fullName ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    city: initial?.city ?? '',
    courseId: initial?.course?.id ?? '',
    batchId: initial?.batch?.id ?? '',
    source: initial?.source ?? 'walk_in',
    targetScore: initial?.targetScore === null || initial?.targetScore === undefined ? '' : String(initial.targetScore),
    assignedTo: initial?.assignedTo?.id ?? me,
    followUpOn: initial ? (initial.followUpOn ?? '') : today(),
    notes: initial?.notes ?? '',
  });
  const [studyAbroad, setStudyAbroad] = useState(initial?.studyAbroad ?? false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v, ...(k === 'courseId' ? { batchId: '' } : {}) }));
  const forCourse = batches.filter((b) => !f.courseId || b.courseId === f.courseId);
  const json = {
    ...f,
    email: f.email || null,
    city: f.city || null,
    courseId: f.courseId || null,
    batchId: f.batchId || null,
    targetScore: f.targetScore ? Number(f.targetScore) : null,
    assignedTo: f.assignedTo || null,
    followUpOn: f.followUpOn || null,
    notes: f.notes || null,
    studyAbroad,
    ...(initial?.client ? { clientId: initial.client.id } : {}),
  };
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void post<{ id: string }>(initial ? `/api/courses/enquiries/${initial.id}` : '/api/courses/enquiries', json, initial ? 'PUT' : 'POST', (d) => (initial ? null : `${base}/enquiries/${d.id}`));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required error={fieldErrors.fullName}>
          <TextInput value={f.fullName} onChange={set('fullName')} invalid={Boolean(fieldErrors.fullName)} />
        </Field>
        <Field label="Phone" required error={fieldErrors.phone}>
          <TextInput value={f.phone} onChange={set('phone')} inputMode="tel" invalid={Boolean(fieldErrors.phone)} />
        </Field>
        <Field label="Email" hint="Needed when they enrol" error={fieldErrors.email}>
          <TextInput value={f.email} onChange={set('email')} inputMode="email" invalid={Boolean(fieldErrors.email)} />
        </Field>
        <Field label="City">
          <TextInput value={f.city} onChange={set('city')} />
        </Field>
        <Field label="Course" error={fieldErrors.courseId}>
          <SelectInput value={f.courseId} onChange={set('courseId')} placeholder="Not sure yet" options={courses.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        <Field label="Batch they would like" error={fieldErrors.batchId}>
          <SelectInput value={f.batchId} onChange={set('batchId')} placeholder="Any" options={forCourse.map((b) => ({ value: b.id, label: `${b.code} · starts ${b.startDate} · ${b.days.map((d) => WEEKDAYS[d]).join('/')} ${b.startTime}` }))} />
        </Field>
        <Field label="How they heard / got in touch">
          <SelectInput value={f.source} onChange={set('source')} options={ENQUIRY_SOURCES.map((s) => ({ value: s, label: ENQUIRY_SOURCE_LABEL[s] }))} />
        </Field>
        <Field label="Target score" hint="e.g. 7 overall">
          <TextInput value={f.targetScore} onChange={set('targetScore')} inputMode="decimal" />
        </Field>
        <Field label="Follows it up" error={fieldErrors.assignedTo}>
          <SelectInput value={f.assignedTo} onChange={set('assignedTo')} options={staff.map((s) => ({ value: s.id, label: s.id === me ? `${s.name} (me)` : s.name }))} />
        </Field>
        <Field label="Next follow-up">
          <TextInput type="date" value={f.followUpOn} onChange={set('followUpOn')} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-[13px] text-ink-800">
        <input type="checkbox" checked={studyAbroad} onChange={(e) => setStudyAbroad(e.target.checked)} /> Also thinking of studying abroad
      </label>
      <Field label="Notes">
        <TextArea value={f.notes} onChange={set('notes')} rows={3} />
      </Field>
      {error && <FormAlert>{error}</FormAlert>}
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : initial ? 'Save' : 'Take the enquiry'}
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Working an enquiry                                                   */
/* ------------------------------------------------------------------ */

/** A call or a note, and when to follow up next. */
export function ContactForm({ id }: { id: string }) {
  const { busy, error, post } = usePost();
  const [kind, setKind] = useState<'call' | 'note'>('call');
  const [body, setBody] = useState('');
  const [next, setNext] = useState(addDays(2));
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {(['call', 'note'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={cx('rounded-full px-3 py-1 text-[12.5px] font-medium', kind === k ? 'bg-ink-900 text-paper' : 'bg-ink-100 text-ink-600 hover:bg-ink-200')}>
            {k === 'call' ? 'Spoke to them' : 'A note'}
          </button>
        ))}
      </div>
      <TextArea value={body} onChange={setBody} rows={3} placeholder={kind === 'call' ? 'What did they say?' : 'Note'} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Next follow-up" hint="Leave empty for none">
          <TextInput type="date" value={next} onChange={setNext} />
        </Field>
        <Button
          disabled={busy || body.trim().length < 2}
          onClick={async () => {
            if (await post(`/api/courses/enquiries/${id}/contact`, { kind, body, followUpOn: next || null })) setBody('');
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {error && <FormAlert>{error}</FormAlert>}
    </div>
  );
}

/** Book (or move) a trial class from the next three weeks of classes. */
export function TrialBooker({ id, slots, courseId, rebook }: { id: string; slots: TrialSlotView[]; courseId: string | null; rebook: boolean }) {
  const { busy, error, post } = usePost();
  const offered = courseId ? slots.filter((s) => s.courseId === courseId) : slots;
  const [sessionId, setSessionId] = useState('');
  if (!offered.length) return <p className="text-[13px] text-ink-400">No classes in the next three weeks{courseId ? ' for this course' : ''}.</p>;
  return (
    <div className="space-y-2">
      <SelectInput
        value={sessionId}
        onChange={setSessionId}
        placeholder="Choose a class…"
        options={offered.map((s) => ({
          value: s.sessionId,
          label: `${weekday(s.date)} ${s.date} · ${s.startTime}-${s.endTime} · ${s.courseName} (${s.batchCode})${s.guests ? ` · ${s.guests} guest${s.guests > 1 ? 's' : ''}` : ''}`,
        }))}
      />
      <Button size="sm" variant={rebook ? 'secondary' : 'primary'} disabled={busy || !sessionId} onClick={() => post(`/api/courses/enquiries/${id}/trial`, { sessionId })}>
        {busy ? 'Booking…' : rebook ? 'Move the trial class' : 'Book the trial class'}
      </Button>
      {error && <FormAlert>{error}</FormAlert>}
    </div>
  );
}

/** Did the guest come? On the enquiry and on the trainer's attendance sheet. */
export function TrialOutcomeButtons({ id, outcome }: { id: string; outcome: 'attended' | 'no_show' | null }) {
  const { busy, error, post } = usePost();
  return (
    <div className="space-y-1">
      <div className="flex gap-1.5">
        <Button size="sm" variant={outcome === 'attended' ? 'primary' : 'secondary'} disabled={busy} onClick={() => post(`/api/courses/enquiries/${id}/trial-outcome`, { outcome: 'attended' })}>
          Came
        </Button>
        <Button size="sm" variant={outcome === 'no_show' ? 'danger' : 'secondary'} disabled={busy} onClick={() => post(`/api/courses/enquiries/${id}/trial-outcome`, { outcome: 'no_show' })}>
          Did not come
        </Button>
      </div>
      {error && <p className="text-[12px] text-bad-700">{error}</p>}
    </div>
  );
}

/** They are joining: a seat (or the waiting list) and the fees, their student record made on the way. */
export function ConvertForm({ enquiry, batches, packages, canBill, base }: { enquiry: EnquiryView; batches: BatchSummaryView[]; packages: Option[]; canBill: boolean; base: string }) {
  const { busy, error, fieldErrors, post } = usePost();
  const first = enquiry.batch?.id ?? enquiry.trial?.batchId;
  const [chosen, setChosen] = useState<string[]>(first && batches.some((b) => b.id === first) ? [first] : []);
  const [email, setEmail] = useState(enquiry.email ?? '');
  const [programme, setProgramme] = useState<'course_only' | 'study_abroad'>('course_only');
  const [target, setTarget] = useState(enquiry.targetScore === null ? '' : String(enquiry.targetScore));
  const [invoice, setInvoice] = useState(canBill);
  const [packageId, setPackageId] = useState('');
  const [discount, setDiscount] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const ordered = enquiry.course ? [...batches.filter((b) => b.courseId === enquiry.course!.id), ...batches.filter((b) => b.courseId !== enquiry.course!.id)] : batches;
  const total = batches.filter((b) => chosen.includes(b.id)).reduce((n, b) => n + b.fee, 0);
  return (
    <div className="space-y-4">
      {enquiry.client ? (
        <p className="text-[13px] text-ink-600">
          Enrols <span className="font-medium text-ink-900">{enquiry.client.name}</span>, already on your books.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email" required hint="For their student record and portal login" error={fieldErrors.email}>
            <TextInput value={email} onChange={setEmail} inputMode="email" invalid={Boolean(fieldErrors.email)} />
          </Field>
          <Field label="They are with us for">
            <SelectInput
              value={programme}
              onChange={(v) => setProgramme(v as 'course_only' | 'study_abroad')}
              options={[
                { value: 'course_only', label: 'This course only' },
                { value: 'study_abroad', label: 'The course and study abroad' },
              ]}
            />
          </Field>
        </div>
      )}
      <BatchChecklist batches={ordered} chosen={chosen} setChosen={setChosen} />
      <Field label="Target score">
        <TextInput value={target} onChange={setTarget} inputMode="decimal" />
      </Field>
      <BillingFields
        canBill={canBill}
        total={total}
        packages={packages}
        invoice={invoice}
        setInvoice={setInvoice}
        packageId={packageId}
        setPackageId={setPackageId}
        discount={discount}
        setDiscount={setDiscount}
        discountReason={discountReason}
        setDiscountReason={setDiscountReason}
      />
      {error && <FormAlert>{error}</FormAlert>}
      <Button
        disabled={busy || chosen.length === 0}
        onClick={() =>
          post<{ enrollments: EnrollmentView[] }>(
            `/api/courses/enquiries/${enquiry.id}/convert`,
            {
              batchIds: chosen,
              email: email || null,
              programme,
              targetScore: target ? Number(target) : null,
              invoice: canBill && invoice,
              packageId: packageId || null,
              discount: Number(discount) || 0,
              discountReason: discountReason || null,
            },
            'POST',
            (d) => (d.enrollments?.[0] ? `${base}/enrollments/${d.enrollments[0].id}` : null),
          )
        }
      >
        {busy ? 'Enrolling…' : 'Enrol'}
      </Button>
    </div>
  );
}

export function LostForm({ id }: { id: string }) {
  const { busy, error, post } = usePost();
  const [pick, setPick] = useState('');
  const [other, setOther] = useState('');
  const reason = pick === 'other' ? other : pick;
  return (
    <div className="space-y-2">
      <SelectInput value={pick} onChange={setPick} placeholder="Why are they not joining?" options={[...LOST_REASONS.map((r) => ({ value: r, label: r })), { value: 'other', label: 'Something else…' }]} />
      {pick === 'other' && <TextInput value={other} onChange={setOther} placeholder="The reason" />}
      <Button size="sm" variant="danger" disabled={busy || reason.trim().length < 3} onClick={() => post(`/api/courses/enquiries/${id}/lost`, { reason })}>
        {busy ? 'Closing…' : 'Close the enquiry'}
      </Button>
      {error && <FormAlert>{error}</FormAlert>}
    </div>
  );
}

export function ReopenButton({ id }: { id: string }) {
  const { busy, error, post } = usePost();
  return (
    <div className="space-y-1">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => post(`/api/courses/enquiries/${id}/reopen`, {})}>
        Reopen
      </Button>
      {error && <p className="text-[12px] text-bad-700">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* After the course                                                     */
/* ------------------------------------------------------------------ */

/** A course-only student who now wants to study abroad. Afterwards, straight to their first application. */
export function HandOverForm({ clientId, consultants, currentConsultantId, applicationHref }: { clientId: string; consultants: Option[] | null; currentConsultantId: string | null; applicationHref: string }) {
  const { busy, error, post } = usePost();
  const [consultantId, setConsultantId] = useState(currentConsultantId ?? '');
  const [note, setNote] = useState('');
  return (
    <div className="space-y-3">
      {consultants && (
        <Field label="Consultant who takes them on">
          <SelectInput value={consultantId} onChange={setConsultantId} placeholder="Their current consultant" options={consultants.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
      )}
      <Field label="Note for the consultant" hint="Countries, intake, budget - whatever they told you">
        <TextArea value={note} onChange={setNote} rows={2} />
      </Field>
      {error && <FormAlert>{error}</FormAlert>}
      <Button
        disabled={busy}
        onClick={() => post(`/api/courses/students/${clientId}/hand-over`, { consultantId: consultantId && consultantId !== currentConsultantId ? consultantId : null, note: note || null }, 'POST', () => applicationHref)}
      >
        {busy ? 'Handing over…' : 'Hand over to study abroad'}
      </Button>
    </div>
  );
}
