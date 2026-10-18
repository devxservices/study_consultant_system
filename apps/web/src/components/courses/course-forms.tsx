'use client';

import { useState, type FormEvent } from 'react';
import {
  localIsoDate,
  ATTENDANCE_STATUS_LABEL,
  ATTENDANCE_STATUSES,
  ASSESSMENT_KIND_LABEL,
  ASSESSMENT_KINDS,
  BATCH_STATUS_LABEL,
  BATCH_STATUSES,
  COURSE_LEVEL_LABEL,
  COURSE_LEVELS,
  COURSE_MODE_LABEL,
  COURSE_MODES,
  CURRENCIES,
  TEST_RESULT_STATUS_LABEL,
  TEST_RESULT_STATUSES,
  TEST_SCALES,
  TEST_TYPE_LABEL,
  TEST_TYPES,
  WEEKDAYS,
  overallScore,
  type AssessmentView,
  type AttendanceSheet,
  type AttendanceStatus,
  type BatchSummaryView,
  type CourseSettingsView,
  type CourseView,
  type EnrollmentView,
  type TestResultView,
  type TestType,
} from '@crm/shared';
import { Button, cx } from '../ui';
import { callApi, Field, FormAlert, SelectInput, TextArea, TextInput } from '../forms';
import { usePost } from '../use-post';

const today = () => localIsoDate();
type Option = { id: string; name: string };

/* ------------------------------------------------------------------ */
/* Courses and batches                                                  */
/* ------------------------------------------------------------------ */

export function CourseForm({ initial, base, packages }: { initial: CourseView | null; base: string; packages: Option[] }) {
  const { busy, error, fieldErrors, post } = usePost();
  const [f, setF] = useState({
    name: initial?.name ?? '',
    code: initial?.code ?? '',
    testType: initial?.testType ?? 'ielts_academic',
    level: initial?.level ?? 'any',
    mode: initial?.mode ?? 'in_person',
    description: initial?.description ?? '',
    durationWeeks: String(initial?.durationWeeks ?? 6),
    hoursPerWeek: String(initial?.hoursPerWeek ?? 6),
    fee: initial ? String(initial.fee / 100) : '',
    currency: initial?.currency ?? 'PKR',
    packageId: initial?.packageId ?? '',
    capacity: String(initial?.capacity ?? 20),
  });
  const [active, setActive] = useState(initial?.active ?? true);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const body = { ...f, description: f.description || null, fee: Number(f.fee) || 0, packageId: f.packageId || null, durationWeeks: Number(f.durationWeeks), hoursPerWeek: Number(f.hoursPerWeek), capacity: Number(f.capacity), active };
    const r = await post<{ id: string }>(initial ? `/api/courses/${initial.id}` : '/api/courses', body, initial ? 'PUT' : 'POST', (d) => (initial ? null : `${base}/${d.id}`));
    if (r && initial) setSaved(true);
  }
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
        <Field label="Name" error={fieldErrors.name}>
          <TextInput value={f.name} onChange={set('name')} placeholder="IELTS Academic preparation" />
        </Field>
        <Field label="Code" error={fieldErrors.code}>
          <TextInput value={f.code} onChange={set('code')} placeholder="IELTS-A" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Prepares for" hint="Decides how mock tests are scored">
          <SelectInput value={f.testType} onChange={set('testType')} options={TEST_TYPES.map((t) => ({ value: t, label: TEST_TYPE_LABEL[t] }))} />
        </Field>
        <Field label="Level">
          <SelectInput value={f.level} onChange={set('level')} options={COURSE_LEVELS.map((l) => ({ value: l, label: COURSE_LEVEL_LABEL[l] }))} />
        </Field>
        <Field label="Taught">
          <SelectInput value={f.mode} onChange={set('mode')} options={COURSE_MODES.map((m) => ({ value: m, label: COURSE_MODE_LABEL[m] }))} />
        </Field>
        <Field label="Weeks">
          <TextInput value={f.durationWeeks} onChange={set('durationWeeks')} inputMode="numeric" />
        </Field>
        <Field label="Hours a week">
          <TextInput value={f.hoursPerWeek} onChange={set('hoursPerWeek')} inputMode="decimal" />
        </Field>
        <Field label="Seats in a batch" hint="The default for new batches">
          <TextInput value={f.capacity} onChange={set('capacity')} inputMode="numeric" />
        </Field>
        <Field label="Fee">
          <TextInput value={f.fee} onChange={set('fee')} inputMode="decimal" />
        </Field>
        <Field label="Currency">
          <SelectInput value={f.currency} onChange={set('currency')} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label="Or bill by a package" hint="A course package from the fee catalogue" error={fieldErrors.packageId}>
          <SelectInput value={f.packageId} onChange={set('packageId')} placeholder="Its own fee" options={packages.map((p) => ({ value: p.id, label: p.name }))} />
        </Field>
      </div>
      <Field label="Description" hint="Shown to students">
        <TextArea value={f.description} onChange={set('description')} rows={4} />
      </Field>
      <label className="flex items-center gap-2 text-[13px] text-ink-700">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Offered (new batches can be run)
      </label>
      {error && <FormAlert>{error}</FormAlert>}
      {saved && <FormAlert tone="ok">Saved.</FormAlert>}
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : initial ? 'Save changes' : 'Add course'}
      </Button>
    </form>
  );
}

export function BatchForm({ initial, courses, trainers, base, courseId }: { initial: (BatchSummaryView & { notes?: string | null }) | null; courses: CourseView[]; trainers: Option[]; base: string; courseId?: string }) {
  const { busy, error, fieldErrors, post } = usePost();
  const course = courses.find((c) => c.id === (initial?.courseId ?? courseId)) ?? courses[0];
  const [f, setF] = useState({
    courseId: initial?.courseId ?? course?.id ?? '',
    code: initial?.code ?? '',
    startDate: initial?.startDate ?? today(),
    endDate: initial?.endDate ?? '',
    startTime: initial?.startTime ?? '18:00',
    endTime: initial?.endTime ?? '20:00',
    location: initial?.location ?? '',
    onlineLink: initial?.onlineLink ?? '',
    capacity: String(initial?.capacity ?? course?.capacity ?? 20),
    fee: '',
    status: initial?.status ?? 'enrolling',
    notes: initial?.notes ?? '',
  });
  const [days, setDays] = useState<number[]>(initial?.days ?? [1, 3, 5]);
  const [trainerIds, setTrainerIds] = useState<string[]>(initial?.trainers.map((t) => t.userId) ?? []);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { ...f, days, trainerIds, capacity: Number(f.capacity), fee: f.fee === '' ? null : Number(f.fee), location: f.location || null, onlineLink: f.onlineLink || null, notes: f.notes || null };
    await post<{ id: string }>(initial ? `/api/courses/batches/${initial.id}` : '/api/courses/batches', body, initial ? 'PUT' : 'POST', (d) => (initial ? null : `${base}/batches/${d.id}`));
  }
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Course">
          <SelectInput value={f.courseId} onChange={set('courseId')} options={courses.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        <Field label="Batch code" error={fieldErrors.code}>
          <TextInput value={f.code} onChange={set('code')} placeholder="IELTS-NOV-EVE" />
        </Field>
        <Field label="First day">
          <TextInput type="date" value={f.startDate} onChange={set('startDate')} />
        </Field>
        <Field label="Last day" error={fieldErrors.endDate}>
          <TextInput type="date" value={f.endDate} onChange={set('endDate')} />
        </Field>
      </div>
      <div>
        <p className="mb-1 text-[13px] font-medium text-ink-700">Meets on</p>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d, i) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i].sort()))}
              className={cx('h-8 w-12 rounded-md text-[12.5px] font-medium', days.includes(i) ? 'bg-brand-600 text-paper' : 'bg-ink-100 text-ink-600')}
            >
              {d}
            </button>
          ))}
        </div>
        {fieldErrors.days && <p className="mt-1 text-[12px] text-bad-700">{fieldErrors.days}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="From">
          <TextInput type="time" value={f.startTime} onChange={set('startTime')} />
        </Field>
        <Field label="To" error={fieldErrors.endTime}>
          <TextInput type="time" value={f.endTime} onChange={set('endTime')} />
        </Field>
        <Field label="Seats">
          <TextInput value={f.capacity} onChange={set('capacity')} inputMode="numeric" />
        </Field>
        <Field label="Fee" hint="Empty: the course's">
          <TextInput value={f.fee} onChange={set('fee')} inputMode="decimal" />
        </Field>
        <Field label="Room or place" className="sm:col-span-2">
          <TextInput value={f.location} onChange={set('location')} />
        </Field>
        <Field label="Online link" className="sm:col-span-2" error={fieldErrors.onlineLink}>
          <TextInput value={f.onlineLink} onChange={set('onlineLink')} placeholder="https://meet…" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status">
          <SelectInput value={f.status} onChange={set('status')} options={BATCH_STATUSES.filter((s) => s !== 'completed').map((s) => ({ value: s, label: BATCH_STATUS_LABEL[s] }))} />
        </Field>
        <div>
          <p className="mb-1 text-[13px] font-medium text-ink-700">Trainers</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {trainers.length === 0 && <span className="text-ink-400">Give someone “Teach batches” to choose them here.</span>}
            {trainers.map((t) => (
              <label key={t.id} className="flex items-center gap-1.5">
                <input type="checkbox" checked={trainerIds.includes(t.id)} onChange={(e) => setTrainerIds((x) => (e.target.checked ? [...x, t.id] : x.filter((y) => y !== t.id)))} />
                {t.name}
              </label>
            ))}
          </div>
        </div>
      </div>
      <Field label="Notes">
        <TextArea value={f.notes} onChange={set('notes')} rows={2} />
      </Field>
      {initial && <p className="text-[12px] text-ink-400">Changing the dates, days or times redoes the sessions still to come; held ones stay as they were.</p>}
      {error && <FormAlert>{error}</FormAlert>}
      <Button type="submit" disabled={busy || days.length === 0}>
        {busy ? 'Saving…' : initial ? 'Save batch' : 'Add batch'}
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Enrolling                                                            */
/* ------------------------------------------------------------------ */

/** The batches to enrol in: one, or several billed together. */
export function BatchChecklist({ batches, chosen, setChosen }: { batches: BatchSummaryView[]; chosen: string[]; setChosen: (f: (x: string[]) => string[]) => void }) {
  return (
    <div>
      <p className="mb-1 text-[13px] font-medium text-ink-700">Batches</p>
      <div className="divide-y divide-line rounded-lg border border-line">
        {batches.length === 0 && <p className="px-3 py-2 text-[13px] text-ink-400">No batch is taking students.</p>}
        {batches.map((b) => (
          <label key={b.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
            <input type="checkbox" checked={chosen.includes(b.id)} onChange={(e) => setChosen((x) => (e.target.checked ? [...x, b.id] : x.filter((y) => y !== b.id)))} />
            <span className="min-w-0 flex-1">
              <span className="font-medium text-ink-900">{b.courseName}</span>
              <span className="text-ink-500">
                {' '}
                · {b.code} · {b.startDate} to {b.endDate} · {b.days.map((d) => WEEKDAYS[d]).join('/')} {b.startTime}-{b.endTime}
              </span>
            </span>
            <span className={cx('text-[12px]', b.enrolled >= b.capacity ? 'text-warn-700' : 'text-ink-500')}>{b.enrolled >= b.capacity ? `Full - waiting list (${b.waitlisted})` : `${b.capacity - b.enrolled} seats left`}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** Billing the course fees on one invoice, by each course's fee or a package, with a discount. */
export function BillingFields(p: {
  canBill: boolean;
  total: number;
  packages: Option[];
  invoice: boolean;
  setInvoice: (v: boolean) => void;
  packageId: string;
  setPackageId: (v: string) => void;
  discount: string;
  setDiscount: (v: string) => void;
  discountReason: string;
  setDiscountReason: (v: string) => void;
}) {
  if (!p.canBill) return <p className="text-[12.5px] text-ink-500">Fees are billed separately by someone who can create invoices.</p>;
  return (
    <div className="space-y-2 rounded-lg bg-ink-50 p-3">
      <label className="flex items-center gap-2 text-[13px] text-ink-800">
        <input type="checkbox" checked={p.invoice} onChange={(e) => p.setInvoice(e.target.checked)} /> Bill the fees now, on one invoice
      </label>
      {p.invoice && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Price" hint={p.packageId ? 'The package price' : `${p.total ? (p.total / 100).toFixed(2) : '0'} from the courses`}>
            <SelectInput value={p.packageId} onChange={p.setPackageId} placeholder="Each course's fee" options={p.packages.map((x) => ({ value: x.id, label: x.name }))} />
          </Field>
          <Field label="Discount">
            <TextInput value={p.discount} onChange={p.setDiscount} inputMode="decimal" />
          </Field>
          {Number(p.discount) > 0 && (
            <Field label="Why">
              <TextInput value={p.discountReason} onChange={p.setDiscountReason} />
            </Field>
          )}
        </div>
      )}
    </div>
  );
}

export function EnrolForm({ clientId, clients, batches, packages, canBill, done }: { clientId: string | null; clients: Option[]; batches: BatchSummaryView[]; packages: Option[]; canBill: boolean; done: string }) {
  const { busy, error, post } = usePost();
  const [student, setStudent] = useState(clientId ?? '');
  const [chosen, setChosen] = useState<string[]>([]);
  const [invoice, setInvoice] = useState(canBill);
  const [packageId, setPackageId] = useState('');
  const [target, setTarget] = useState('');
  const [discount, setDiscount] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const total = batches.filter((b) => chosen.includes(b.id)).reduce((n, b) => n + b.fee, 0);
  return (
    <div className="space-y-4">
      {!clientId && (
        <Field label="Student">
          <SelectInput value={student} onChange={setStudent} placeholder="Choose…" options={clients.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
      )}
      <BatchChecklist batches={batches} chosen={chosen} setChosen={setChosen} />
      <Field label="Target score" hint="What they are aiming for (e.g. 7 overall)">
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
        disabled={busy || !student || chosen.length === 0}
        onClick={() =>
          post<{ id: string }[]>(
            '/api/courses/enrollments',
            { clientId: student, batchIds: chosen, targetScore: target ? Number(target) : null, invoice: canBill && invoice, packageId: packageId || null, discount: Number(discount) || 0, discountReason: discountReason || null },
            'POST',
            () => done,
          )
        }
      >
        {busy ? 'Enrolling…' : 'Enrol'}
      </Button>
    </div>
  );
}

export function EnrollmentActions({ e, batches, canManage }: { e: EnrollmentView; batches: BatchSummaryView[]; canManage: boolean }) {
  const { busy, error, post } = usePost();
  const [open, setOpen] = useState<null | 'transfer' | 'freeze' | 'drop'>(null);
  const [to, setTo] = useState('');
  const [from, setFrom] = useState(today());
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const live = e.status === 'enrolled' || e.status === 'frozen' || e.status === 'waitlisted';
  const go = async (url: string, json: unknown = {}) => {
    if (await post(url, json)) {
      setOpen(null);
      setReason('');
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {live && (
          <Button size="sm" variant="secondary" onClick={() => setOpen('transfer')}>
            Move to another batch
          </Button>
        )}
        {e.status === 'enrolled' && (
          <Button size="sm" variant="secondary" onClick={() => setOpen('freeze')}>
            Pause
          </Button>
        )}
        {e.status === 'frozen' && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => go(`/api/courses/enrollments/${e.id}/resume`)}>
            Back in class
          </Button>
        )}
        {canManage && (e.status === 'enrolled' || e.status === 'frozen') && (
          <Button size="sm" disabled={busy} onClick={() => go(`/api/courses/enrollments/${e.id}/complete`)}>
            Mark completed
          </Button>
        )}
        {live && (
          <Button size="sm" variant="ghost" onClick={() => setOpen('drop')}>
            Drop
          </Button>
        )}
      </div>
      {open && (
        <div className="space-y-2 rounded-lg bg-ink-50 p-3">
          {open === 'transfer' && <SelectInput value={to} onChange={setTo} placeholder="To batch…" options={batches.filter((b) => b.id !== e.batchId).map((b) => ({ value: b.id, label: `${b.code} · ${b.courseName} · ${b.startDate}${b.enrolled >= b.capacity ? ' (full)' : ''}` }))} />}
          {open === 'freeze' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="From">
                <TextInput type="date" value={from} onChange={setFrom} />
              </Field>
              <Field label="Back on">
                <TextInput type="date" value={until} onChange={setUntil} />
              </Field>
            </div>
          )}
          <TextInput value={reason} onChange={setReason} placeholder="Why?" />
          {error && <p className="text-[12px] text-bad-700">{error}</p>}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={open === 'drop' ? 'danger' : 'primary'}
              disabled={busy || reason.trim().length < 5 || (open === 'transfer' && !to) || (open === 'freeze' && !until)}
              onClick={() =>
                open === 'transfer'
                  ? go(`/api/courses/enrollments/${e.id}/transfer`, { batchId: to, reason })
                  : open === 'freeze'
                    ? go(`/api/courses/enrollments/${e.id}/freeze`, { from, until, reason })
                    : go(`/api/courses/enrollments/${e.id}/drop`, { reason })
              }
            >
              {open === 'transfer' ? 'Move' : open === 'freeze' ? 'Pause' : 'Drop'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {!open && error && <p className="text-[12px] text-bad-700">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Attendance                                                           */
/* ------------------------------------------------------------------ */

const TONE: Record<AttendanceStatus, string> = { present: 'bg-ok-600 text-paper', late: 'bg-warn-500 text-paper', absent: 'bg-bad-600 text-paper', excused: 'bg-ink-500 text-paper' };

export function AttendanceForm({ sheet, canMark }: { sheet: AttendanceSheet; canMark: boolean }) {
  const { busy, error, post } = usePost();
  const [marks, setMarks] = useState<Record<string, AttendanceStatus | null>>(Object.fromEntries(sheet.rows.map((r) => [r.enrollmentId, r.status ?? (r.frozen ? 'excused' : null)])));
  const [saved, setSaved] = useState(false);
  const future = sheet.session.date > today();
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {canMark && !future && (
          <Button size="sm" variant="ghost" onClick={() => setMarks((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v ?? 'present'])))}>
            Everyone else present
          </Button>
        )}
      </div>
      <div className="divide-y divide-line rounded-lg border border-line">
        {sheet.rows.map((r) => (
          <div key={r.enrollmentId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
            <span className="text-ink-900">
              {r.clientName}
              {r.frozen && <span className="text-[12px] text-ink-400"> · paused</span>}
            </span>
            <span className="flex gap-1">
              {ATTENDANCE_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={!canMark || future}
                  onClick={() => setMarks((m) => ({ ...m, [r.enrollmentId]: s }))}
                  className={cx('h-7 rounded-md px-2.5 text-[12px] font-medium', marks[r.enrollmentId] === s ? TONE[s] : 'bg-ink-100 text-ink-600', (!canMark || future) && 'opacity-60')}
                >
                  {ATTENDANCE_STATUS_LABEL[s]}
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>
      {future && <p className="text-[12.5px] text-ink-500">Attendance is taken once the session has happened.</p>}
      {error && <FormAlert>{error}</FormAlert>}
      {saved && <FormAlert tone="ok">Saved.</FormAlert>}
      {canMark && !future && (
        <Button
          disabled={busy || Object.values(marks).every((v) => !v)}
          onClick={async () => {
            setSaved(false);
            const list = Object.entries(marks)
              .filter(([, v]) => v)
              .map(([enrollmentId, status]) => ({ enrollmentId, status }));
            setSaved(Boolean(await post(`/api/courses/sessions/${sheet.session.id}/attendance`, { marks: list }, 'PUT')));
          }}
        >
          Save attendance
        </Button>
      )}
    </div>
  );
}

export function SessionEdit({ sessionId, topic, cancelled }: { sessionId: string; topic: string | null; cancelled: boolean }) {
  const { busy, post } = usePost();
  const [value, setValue] = useState(topic ?? '');
  return (
    <span className="flex flex-wrap items-center gap-2">
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Topic" className="h-8 w-48 rounded-md border border-line-strong bg-paper px-2 text-[12.5px]" />
      <Button size="sm" variant="ghost" disabled={busy || value === (topic ?? '')} onClick={() => post(`/api/courses/sessions/${sessionId}`, { topic: value || null }, 'PUT')}>
        Save
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => post(`/api/courses/sessions/${sessionId}`, { cancelled: !cancelled }, 'PUT')}>
        {cancelled ? 'Restore' : 'Cancel class'}
      </Button>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Mock tests                                                           */
/* ------------------------------------------------------------------ */

export function AddAssessment({ batchId }: { batchId: string }) {
  const { busy, error, post } = usePost();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('mock');
  const [heldOn, setHeldOn] = useState(today());
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-56">
        <Field label="Title">
          <TextInput value={title} onChange={setTitle} placeholder="Mock test 2" />
        </Field>
      </div>
      <div className="w-40">
        <Field label="Kind">
          <SelectInput value={kind} onChange={setKind} options={ASSESSMENT_KINDS.map((k) => ({ value: k, label: ASSESSMENT_KIND_LABEL[k] }))} />
        </Field>
      </div>
      <div className="w-40">
        <Field label="Held on">
          <TextInput type="date" value={heldOn} onChange={setHeldOn} />
        </Field>
      </div>
      <Button size="sm" disabled={busy || title.trim().length < 2} onClick={async () => (await post(`/api/courses/batches/${batchId}/assessments`, { title, kind, heldOn })) && setTitle('')}>
        Add
      </Button>
      {error && <p className="w-full text-[12px] text-bad-700">{error}</p>}
    </div>
  );
}

export function ScoresGrid({ assessment, roster, canRecord }: { assessment: AssessmentView; roster: { enrollmentId: string; clientName: string }[]; canRecord: boolean }) {
  const { busy, error, post } = usePost();
  const test = assessment.testType as TestType;
  const scale = TEST_SCALES[test];
  const initial = Object.fromEntries(
    roster.map((r) => {
      const s = assessment.scores.find((x) => x.enrollmentId === r.enrollmentId);
      return [r.enrollmentId, { ...Object.fromEntries(scale.modules.map((m) => [m.key, s?.scores[m.key] === null || s?.scores[m.key] === undefined ? '' : String(s.scores[m.key])])), overall: s?.overall === null || s?.overall === undefined ? '' : String(s.overall), feedback: s?.feedback ?? '' }];
    }),
  ) as Record<string, Record<string, string>>;
  const [rows, setRows] = useState(initial);
  const [saved, setSaved] = useState(false);
  const setCell = (id: string, k: string, v: string) => setRows((x) => ({ ...x, [id]: { ...x[id]!, [k]: v } }));
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="text-left text-[11px] uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-2 py-1">Student</th>
              {scale.modules.map((m) => (
                <th key={m.key} className="px-2 py-1">
                  {m.label}
                </th>
              ))}
              {scale.overall !== 'none' && <th className="px-2 py-1">Overall</th>}
              <th className="px-2 py-1">Feedback</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((r) => {
              const v = rows[r.enrollmentId]!;
              const worked = overallScore(test, Object.fromEntries(scale.modules.map((m) => [m.key, v[m.key] === '' ? null : Number(v[m.key])])));
              return (
                <tr key={r.enrollmentId} className="border-t border-line">
                  <td className="px-2 py-1.5 text-ink-900">{r.clientName}</td>
                  {scale.modules.map((m) => (
                    <td key={m.key} className="px-2 py-1.5">
                      <input value={v[m.key]} disabled={!canRecord} onChange={(e) => setCell(r.enrollmentId, m.key, e.target.value)} inputMode="decimal" className="h-8 w-16 rounded-md border border-line-strong bg-paper px-2" />
                    </td>
                  ))}
                  {scale.overall !== 'none' && (
                    <td className="px-2 py-1.5">
                      {scale.overall === 'entered' ? (
                        <input value={v.overall} disabled={!canRecord} onChange={(e) => setCell(r.enrollmentId, 'overall', e.target.value)} inputMode="decimal" className="h-8 w-16 rounded-md border border-line-strong bg-paper px-2" />
                      ) : (
                        <span className="tnum font-semibold text-ink-900">{worked ?? '–'}</span>
                      )}
                    </td>
                  )}
                  <td className="px-2 py-1.5">
                    <input value={v.feedback} disabled={!canRecord} onChange={(e) => setCell(r.enrollmentId, 'feedback', e.target.value)} className="h-8 w-full min-w-40 rounded-md border border-line-strong bg-paper px-2" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11.5px] text-ink-400">
        {scale.min} to {scale.max} in steps of {scale.step}.{' '}
        {scale.overall === 'ielts' ? 'The overall is the average of the four bands, rounded to the nearest half band (a quarter rounds up).' : scale.overall === 'sum' ? 'The overall is the sum of the sections.' : scale.overall === 'entered' ? 'Enter the overall as the test reports it.' : ''}
      </p>
      {error && <FormAlert>{error}</FormAlert>}
      {saved && <FormAlert tone="ok">Saved.</FormAlert>}
      {canRecord && (
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setSaved(false);
            const scores = Object.entries(rows)
              .filter(([, v]) => scale.modules.some((m) => v[m.key] !== '') || v.overall !== '')
              .map(([enrollmentId, v]) => ({
                enrollmentId,
                scores: Object.fromEntries(scale.modules.map((m) => [m.key, v[m.key] === '' ? null : Number(v[m.key])])),
                overall: v.overall === '' ? null : Number(v.overall),
                feedback: v.feedback || null,
              }));
            if (scores.length) setSaved(Boolean(await post(`/api/courses/assessments/${assessment.id}/scores`, { scores }, 'PUT')));
          }}
        >
          Save scores
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Homework                                                             */
/* ------------------------------------------------------------------ */

export function AddHomework({ batchId }: { batchId: string }) {
  const { busy, error, send } = usePost();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ kind: 'homework', title: '', instructions: '', due: '', maxScore: '' });
  const [file, setFile] = useState<File | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Set homework or share material
      </Button>
    );
  }
  return (
    <div className="w-full space-y-2 rounded-lg border border-line p-3">
      <div className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)]">
        <SelectInput
          value={f.kind}
          onChange={set('kind')}
          options={[
            { value: 'homework', label: 'Homework' },
            { value: 'material', label: 'Material' },
          ]}
        />
        <TextInput value={f.title} onChange={set('title')} placeholder="Title" />
      </div>
      <TextArea value={f.instructions} onChange={set('instructions')} rows={3} placeholder={f.kind === 'homework' ? 'What to do' : 'A note about it'} />
      {f.kind === 'homework' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Due">
            <TextInput type="datetime-local" value={f.due} onChange={set('due')} />
          </Field>
          <Field label="Marked out of">
            <TextInput value={f.maxScore} onChange={set('maxScore')} inputMode="decimal" />
          </Field>
        </div>
      )}
      <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[13px]" />
      {error && <p className="text-[12px] text-bad-700">{error}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || f.title.trim().length < 2}
          onClick={async () => {
            const form = new FormData();
            form.append('kind', f.kind);
            form.append('title', f.title);
            if (f.instructions) form.append('instructions', f.instructions);
            if (f.kind === 'homework' && f.due) form.append('dueAt', new Date(f.due).toISOString());
            if (f.kind === 'homework' && f.maxScore) form.append('maxScore', f.maxScore);
            if (file) form.append('file', file);
            if (await send(`/api/courses/batches/${batchId}/homework`, form)) {
              setOpen(false);
              setF({ kind: 'homework', title: '', instructions: '', due: '', maxScore: '' });
              setFile(null);
            }
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function GradeSubmission({ id, maxScore }: { id: string; maxScore: number | null }) {
  const { busy, error, post } = usePost();
  const [score, setScore] = useState('');
  const [feedback, setFeedback] = useState('');
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input value={score} onChange={(e) => setScore(e.target.value)} placeholder={maxScore ? `/ ${maxScore}` : 'Score'} inputMode="decimal" className="h-8 w-20 rounded-md border border-line-strong bg-paper px-2 text-[12.5px]" />
      <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Feedback" className="h-8 w-64 rounded-md border border-line-strong bg-paper px-2 text-[12.5px]" />
      <Button size="sm" disabled={busy} onClick={() => post(`/api/courses/submissions/${id}/grade`, { score: score ? Number(score) : null, feedback: feedback || null })}>
        Mark
      </Button>
      <Button size="sm" variant="ghost" disabled={busy || !feedback} onClick={() => post(`/api/courses/submissions/${id}/grade`, { returned: true, feedback })}>
        Send back
      </Button>
      {error && <span className="text-[12px] text-bad-700">{error}</span>}
    </div>
  );
}

/** The student hands in homework. */
export function SubmitHomework({ homeworkId, again }: { homeworkId: string; again: boolean }) {
  const { busy, error, send } = usePost();
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [open, setOpen] = useState(!again);
  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Hand in again
      </Button>
    );
  }
  return (
    <div className="mt-2 space-y-2">
      <TextArea value={text} onChange={setText} rows={3} placeholder="Your answer (or attach a file)" />
      <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[13px]" />
      {error && <p className="text-[12px] text-bad-700">{error}</p>}
      <Button
        size="sm"
        disabled={busy || (!text.trim() && !file)}
        onClick={async () => {
          const form = new FormData();
          if (text.trim()) form.append('text', text.trim());
          if (file) form.append('file', file);
          if (await send(`/api/my-courses/homework/${homeworkId}/submit`, form)) setOpen(false);
        }}
      >
        {busy ? 'Handing in…' : 'Hand in'}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Official results and settings                                        */
/* ------------------------------------------------------------------ */

export function TestResultForm({ clients, clientId, initial }: { clients: Option[]; clientId: string | null; initial: TestResultView | null }) {
  const [open, setOpen] = useState(false);
  const [student, setStudent] = useState(initial?.clientId ?? clientId ?? '');
  const [testType, setTestType] = useState<TestType>((initial?.testType as TestType) ?? 'ielts_academic');
  const [status, setStatus] = useState<string>(initial?.status ?? 'booked');
  const [testDate, setTestDate] = useState(initial?.testDate ?? '');
  const [venue, setVenue] = useState(initial?.venue ?? '');
  const [reference, setReference] = useState(initial?.reference ?? '');
  const [scores, setScores] = useState<Record<string, string>>(Object.fromEntries(Object.entries(initial?.scores ?? {}).map(([k, v]) => [k, v === null ? '' : String(v)])));
  const [overall, setOverall] = useState(initial?.overall === null || initial?.overall === undefined ? '' : String(initial.overall));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scale = TEST_SCALES[testType];
  const { router } = usePost();
  if (!open) {
    return (
      <Button size="sm" variant={initial ? 'ghost' : 'primary'} onClick={() => setOpen(true)}>
        {initial ? (initial.status === 'result' ? 'Correct it' : 'Record the result') : 'Record a test booking or result'}
      </Button>
    );
  }
  async function save() {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('clientId', student);
    form.append('testType', testType);
    form.append('status', status);
    form.append('testDate', testDate);
    if (venue) form.append('venue', venue);
    if (reference) form.append('reference', reference);
    form.append('scores', JSON.stringify(Object.fromEntries(scale.modules.map((m) => [m.key, scores[m.key] ? Number(scores[m.key]) : null]))));
    if (overall) form.append('overall', overall);
    if (file) form.append('file', file);
    const res = await callApi(initial ? `/api/courses/results/${initial.id}` : '/api/courses/results', { method: initial ? 'PUT' : 'POST', form });
    setBusy(false);
    if (!res.ok) {
      setError(res.message ?? Object.values(res.fieldErrors)[0] ?? 'That did not work.');
      return;
    }
    setOpen(false);
    router.refresh();
  }
  return (
    <div className="w-full space-y-3 rounded-lg border border-line bg-paper p-4">
      {!clientId && !initial && (
        <Field label="Student">
          <SelectInput value={student} onChange={setStudent} placeholder="Choose…" options={clients.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Test">
          <SelectInput value={testType} onChange={(v) => setTestType(v as TestType)} options={TEST_TYPES.filter((t) => t !== 'none').map((t) => ({ value: t, label: TEST_TYPE_LABEL[t] }))} />
        </Field>
        <Field label="Status">
          <SelectInput value={status} onChange={setStatus} options={TEST_RESULT_STATUSES.map((s) => ({ value: s, label: TEST_RESULT_STATUS_LABEL[s] }))} />
        </Field>
        <Field label="Test date">
          <TextInput type="date" value={testDate} onChange={setTestDate} />
        </Field>
        <Field label="Venue">
          <TextInput value={venue} onChange={setVenue} />
        </Field>
        <Field label="Booking reference or report number">
          <TextInput value={reference} onChange={setReference} />
        </Field>
      </div>
      {status === 'result' && (
        <>
          <div className="flex flex-wrap gap-2">
            {scale.modules.map((m) => (
              <div key={m.key} className="w-28">
                <Field label={m.label}>
                  <TextInput value={scores[m.key] ?? ''} onChange={(v) => setScores((x) => ({ ...x, [m.key]: v }))} inputMode="decimal" />
                </Field>
              </div>
            ))}
            {(scale.overall === 'entered' || scale.overall === 'none') && (
              <div className="w-28">
                <Field label="Overall">
                  <TextInput value={overall} onChange={setOverall} inputMode="decimal" />
                </Field>
              </div>
            )}
          </div>
          <Field label="Score report (TRF)" hint="Filed with the student's documents; it expires with the result, two years after the test">
            <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[13px]" />
          </Field>
        </>
      )}
      {error && <FormAlert>{error}</FormAlert>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !student || !testDate} onClick={save}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function CourseSettingsForm({ settings }: { settings: CourseSettingsView }) {
  const { busy, error, post } = usePost();
  const [after, setAfter] = useState(String(settings.absenceAlertAfter));
  const [min, setMin] = useState(String(settings.certificateMinAttendance));
  const [saved, setSaved] = useState(false);
  return (
    <div className="max-w-md space-y-3">
      <Field label="Tell the consultant after this many absences in a row">
        <TextInput value={after} onChange={(v) => setAfter(v.replace(/\D/g, ''))} inputMode="numeric" />
      </Field>
      <Field label="Attendance needed for a certificate (%)">
        <TextInput value={min} onChange={(v) => setMin(v.replace(/\D/g, ''))} inputMode="numeric" />
      </Field>
      {error && <FormAlert>{error}</FormAlert>}
      {saved && <FormAlert tone="ok">Saved.</FormAlert>}
      <Button disabled={busy} onClick={async () => setSaved(Boolean(await post('/api/courses/settings', { absenceAlertAfter: Number(after), certificateMinAttendance: Number(min) }, 'PUT')))}>
        Save
      </Button>
    </div>
  );
}

export function CompleteBatch({ batchId }: { batchId: string }) {
  const { busy, error, post } = usePost();
  return (
    <span className="flex flex-col gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() => {
          if (window.confirm('Finish the batch? Everyone still in it completes (with a certificate where attendance was enough), and anyone still waiting is told there was no seat.')) post(`/api/courses/batches/${batchId}/complete`, {});
        }}
      >
        Finish the batch
      </Button>
      {error && <span className="text-[12px] text-bad-700">{error}</span>}
    </span>
  );
}
