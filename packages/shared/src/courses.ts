import { z } from 'zod';
import { CURRENCIES, type Currency } from './billing';
import { dateOnlySchema } from './profile';
import { uuidSchema } from './dto/common';
import type { LanguageRequirement } from './workflow';

/*
 * Courses and test preparation: IELTS, PTE, TOEFL and the rest, or any course
 * the consultancy runs (spoken English, interview preparation...).
 *
 * A course is in the catalogue; a batch is one run of it - dates, a timetable,
 * a room or a link, trainers and a number of seats. Students are enrolled in a
 * batch (or wait for a seat), can be moved to another, paused or dropped.
 * Trainers take attendance session by session - repeated absence alerts the
 * student's consultant - set mock tests and homework and record the scores.
 * Official test bookings and results are kept per student: a result updates
 * the student's profile, files the score report with its expiry, and is
 * checked against what their destination countries ask for. Fees are billed
 * through finance as course income.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const reasonSchema = z.string().trim().min(5, 'Say why, so the record explains itself later').max(500);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'A time like 18:30');

/* ------------------------------------------------------------------ */
/* Tests and how they are scored                                        */
/* ------------------------------------------------------------------ */

export const TEST_TYPES = ['ielts_academic', 'ielts_general', 'pte_academic', 'toefl_ibt', 'duolingo', 'oet', 'celpip', 'language_cert', 'other', 'none'] as const;
export type TestType = (typeof TEST_TYPES)[number];
export const TEST_TYPE_LABEL: Record<TestType, string> = {
  ielts_academic: 'IELTS Academic',
  ielts_general: 'IELTS General Training',
  pte_academic: 'PTE Academic',
  toefl_ibt: 'TOEFL iBT',
  duolingo: 'Duolingo English Test',
  oet: 'OET',
  celpip: 'CELPIP',
  language_cert: 'LanguageCert',
  other: 'Another test',
  none: 'No test (a course of its own)',
};

export interface TestModule {
  key: string;
  label: string;
}

/**
 * The parts of each test and its scale. `overall` is how the overall score is
 * worked out from the parts: IELTS averages the four bands and rounds to the
 * nearest half band (a quarter rounds up); TOEFL adds the four sections; PTE,
 * Duolingo and the others report their own overall, which is entered.
 */
export const TEST_SCALES: Record<TestType, { modules: TestModule[]; min: number; max: number; step: number; overall: 'ielts' | 'sum' | 'entered' | 'average' | 'none' }> = {
  ielts_academic: { modules: lrws(), min: 0, max: 9, step: 0.5, overall: 'ielts' },
  ielts_general: { modules: lrws(), min: 0, max: 9, step: 0.5, overall: 'ielts' },
  pte_academic: { modules: lrws(), min: 10, max: 90, step: 1, overall: 'entered' },
  toefl_ibt: { modules: lrws(), min: 0, max: 30, step: 1, overall: 'sum' },
  duolingo: {
    modules: [
      { key: 'literacy', label: 'Literacy' },
      { key: 'comprehension', label: 'Comprehension' },
      { key: 'conversation', label: 'Conversation' },
      { key: 'production', label: 'Production' },
    ],
    min: 10,
    max: 160,
    step: 5,
    overall: 'entered',
  },
  oet: { modules: lrws(), min: 0, max: 500, step: 10, overall: 'none' },
  celpip: { modules: lrws(), min: 1, max: 12, step: 1, overall: 'entered' },
  language_cert: { modules: lrws(), min: 0, max: 100, step: 1, overall: 'entered' },
  other: { modules: [{ key: 'score', label: 'Score' }], min: 0, max: 100, step: 0.5, overall: 'average' },
  none: { modules: [{ key: 'score', label: 'Score' }], min: 0, max: 100, step: 0.5, overall: 'average' },
};

function lrws(): TestModule[] {
  return [
    { key: 'listening', label: 'Listening' },
    { key: 'reading', label: 'Reading' },
    { key: 'writing', label: 'Writing' },
    { key: 'speaking', label: 'Speaking' },
  ];
}

/** The overall score from the parts, the way the test itself works it out; null where the test reports its own. */
export function overallScore(test: TestType, scores: Record<string, number | null | undefined>): number | null {
  const scale = TEST_SCALES[test];
  const values = scale.modules.map((m) => scores[m.key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (values.length !== scale.modules.length) return null;
  if (scale.overall === 'ielts') return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 2) / 2;
  if (scale.overall === 'sum') return values.reduce((a, b) => a + b, 0);
  if (scale.overall === 'average') return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
  return null;
}

/** A score on the test's scale, or a message saying what is wrong with it. */
export function checkScore(test: TestType, value: number): string | null {
  const s = TEST_SCALES[test];
  if (value < s.min || value > s.max) return `Between ${s.min} and ${s.max}`;
  const steps = (value - s.min) / s.step;
  if (Math.abs(steps - Math.round(steps)) > 1e-9) return `In steps of ${s.step}`;
  return null;
}

const scoresSchema = z.record(z.string().max(40), z.coerce.number().min(0).max(1000).nullable());

/** Test results are valid for two years from the test date (IELTS, PTE, TOEFL, Duolingo, OET all say so). */
export function resultExpiry(testDate: string): string {
  const d = new Date(`${testDate}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 2);
  return d.toISOString().slice(0, 10);
}

/** Which family a country's requirement names: "IELTS", "PTE Academic", "TOEFL iBT"... */
function familyOf(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes('ielts')) return 'ielts';
  if (t.includes('pte')) return 'pte';
  if (t.includes('toefl')) return 'toefl';
  if (t.includes('duolingo') || t.includes('det')) return 'duolingo';
  if (t.includes('oet')) return 'oet';
  if (t.includes('celpip')) return 'celpip';
  if (t.includes('languagecert') || t.includes('language cert')) return 'language_cert';
  return null;
}
const testFamily = (t: TestType) => (t.startsWith('ielts') ? 'ielts' : t.startsWith('pte') ? 'pte' : t.startsWith('toefl') ? 'toefl' : t);

export interface Eligibility {
  country: string;
  requirement: string;
  meets: boolean;
  /** Why not, when it does not. */
  shortBy: string | null;
}

/** A result checked against what each destination asks for of that test. */
export function eligibility(test: TestType, overall: number | null, scores: Record<string, number | null>, countries: { country: string; requirements: LanguageRequirement[] }[]): Eligibility[] {
  const out: Eligibility[] = [];
  for (const c of countries) {
    for (const r of c.requirements) {
      if (familyOf(r.test) !== testFamily(test)) continue;
      const needOverall = Number.parseFloat(r.overall);
      const needBand = r.minimumBand ? Number.parseFloat(r.minimumBand) : null;
      const lowest = Object.values(scores).filter((v): v is number => typeof v === 'number');
      const minPart = lowest.length ? Math.min(...lowest) : null;
      const reasons: string[] = [];
      if (Number.isFinite(needOverall) && (overall === null || overall < needOverall)) reasons.push(`overall ${overall ?? '?'} of ${r.overall} needed`);
      if (needBand !== null && Number.isFinite(needBand) && (minPart === null || minPart < needBand)) reasons.push(`lowest part ${minPart ?? '?'} of ${r.minimumBand} needed`);
      out.push({ country: c.country, requirement: `${r.test} ${r.overall}${r.minimumBand ? ` (no part below ${r.minimumBand})` : ''}`, meets: reasons.length === 0, shortBy: reasons.length ? reasons.join('; ') : null });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Courses                                                              */
/* ------------------------------------------------------------------ */

export const COURSE_MODES = ['in_person', 'online', 'hybrid'] as const;
export type CourseMode = (typeof COURSE_MODES)[number];
export const COURSE_MODE_LABEL: Record<CourseMode, string> = { in_person: 'In person', online: 'Online', hybrid: 'In person and online' };

export const COURSE_LEVELS = ['any', 'beginner', 'intermediate', 'advanced'] as const;
export type CourseLevel = (typeof COURSE_LEVELS)[number];
export const COURSE_LEVEL_LABEL: Record<CourseLevel, string> = { any: 'All levels', beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };

export const courseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, 'Letters, numbers and dashes'),
  testType: z.enum(TEST_TYPES).default('none'),
  level: z.enum(COURSE_LEVELS).default('any'),
  mode: z.enum(COURSE_MODES).default('in_person'),
  description: optionalText(4000),
  durationWeeks: z.coerce.number().int().min(1).max(104).default(6),
  hoursPerWeek: z.coerce.number().min(0.5).max(60).default(6),
  /** Major units; empty when it is priced from a package in the fee catalogue. */
  fee: z.coerce.number().min(0).max(10_000_000).default(0),
  currency: z.enum(CURRENCIES).default('PKR'),
  /** A course package in the fee catalogue to bill it by (bundles live there). */
  packageId: uuidSchema.nullable().optional(),
  capacity: z.coerce.number().int().min(1).max(500).default(20),
  active: z.boolean().default(true),
});
export type CourseInput = z.input<typeof courseSchema>;

export interface CourseView {
  id: string;
  name: string;
  code: string;
  testType: TestType;
  level: CourseLevel;
  mode: CourseMode;
  description: string | null;
  durationWeeks: number;
  hoursPerWeek: number;
  fee: number;
  currency: Currency;
  packageId: string | null;
  packageName: string | null;
  capacity: number;
  active: boolean;
  batches: { total: number; running: number; upcoming: number };
  students: number;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Batches and their sessions                                           */
/* ------------------------------------------------------------------ */

export const BATCH_STATUSES = ['planned', 'enrolling', 'running', 'completed', 'cancelled'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];
export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  planned: 'Planned',
  enrolling: 'Taking enrolments',
  running: 'Running',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
export const BATCH_STATUS_TONE: Record<BatchStatus, 'ok' | 'warn' | 'bad' | 'neutral' | 'info'> = {
  planned: 'neutral',
  enrolling: 'info',
  running: 'ok',
  completed: 'neutral',
  cancelled: 'bad',
};

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const batchSchema = z
  .object({
    courseId: uuidSchema,
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{2,30}$/, 'Letters, numbers and dashes'),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
    /** Days of the week it meets, 0 = Sunday. */
    days: z.array(z.coerce.number().int().min(0).max(6)).min(1, 'At least one day').max(7),
    startTime: timeSchema,
    endTime: timeSchema,
    location: optionalText(200),
    onlineLink: optionalText(500),
    capacity: z.coerce.number().int().min(1).max(500),
    /** Major units; empty for the course's own fee. */
    fee: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
    status: z.enum(BATCH_STATUSES).default('enrolling'),
    notes: optionalText(2000),
    trainerIds: z.array(uuidSchema).max(10).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.endDate < v.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Ends after it starts' });
    if (v.endTime <= v.startTime) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Ends after it starts' });
    if (v.onlineLink && !/^https:\/\//.test(v.onlineLink)) ctx.addIssue({ code: 'custom', path: ['onlineLink'], message: 'A https:// link' });
  });
export type BatchInput = z.input<typeof batchSchema>;

/** Every date the batch meets: its days of the week between its first and last day. */
export function sessionDates(startDate: string, endDate: string, days: number[]): string[] {
  const out: string[] = [];
  const d = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (d <= end && out.length < 400) {
    if (days.includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export interface BatchSummaryView {
  id: string;
  code: string;
  courseId: string;
  courseName: string;
  testType: TestType;
  startDate: string;
  endDate: string;
  days: number[];
  startTime: string;
  endTime: string;
  location: string | null;
  onlineLink: string | null;
  capacity: number;
  enrolled: number;
  waitlisted: number;
  fee: number;
  currency: Currency;
  status: BatchStatus;
  trainers: { userId: string; name: string }[];
  /** Sessions held so far, and in all. */
  sessionsHeld: number;
  sessionsTotal: number;
}

export interface SessionView {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  topic: string | null;
  cancelled: boolean;
  /** Marked so far: present, late, absent, excused. */
  marked: number;
  present: number;
}

export interface BatchView extends BatchSummaryView {
  notes: string | null;
  sessions: SessionView[];
  roster: EnrollmentView[];
}

export const sessionUpdateSchema = z.object({
  topic: optionalText(200),
  cancelled: z.boolean().optional(),
  /** Moved to another day or time. */
  date: dateOnlySchema.optional(),
  startTime: timeSchema.optional(),
  endTime: timeSchema.optional(),
});

/* ------------------------------------------------------------------ */
/* Enrolments                                                           */
/* ------------------------------------------------------------------ */

/**
 * waitlisted: waiting for a seat (a seat that frees goes to the first in line).
 * enrolled: has a seat.
 * frozen: paused (illness, travel) - keeps the seat, expected back on a date.
 * transferred: moved to another batch (a new enrolment there).
 * dropped: left.
 * completed: finished the batch.
 */
export const ENROLLMENT_STATUSES = ['waitlisted', 'enrolled', 'frozen', 'transferred', 'dropped', 'completed'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];
export const ENROLLMENT_STATUS_LABEL: Record<EnrollmentStatus, string> = {
  waitlisted: 'Waiting for a seat',
  enrolled: 'Enrolled',
  frozen: 'Paused',
  transferred: 'Moved to another batch',
  dropped: 'Dropped',
  completed: 'Completed',
};
export const ENROLLMENT_STATUS_TONE: Record<EnrollmentStatus, 'ok' | 'warn' | 'bad' | 'neutral' | 'info'> = {
  waitlisted: 'warn',
  enrolled: 'ok',
  frozen: 'info',
  transferred: 'neutral',
  dropped: 'bad',
  completed: 'neutral',
};
/** Holding a seat in the batch. */
export const SEATED: readonly EnrollmentStatus[] = ['enrolled', 'frozen'];

export const enrolSchema = z.object({
  clientId: uuidSchema,
  /** One batch, or several for a bundle billed together. */
  batchIds: z.array(uuidSchema).min(1).max(5),
  targetScore: z.coerce.number().min(0).max(1000).nullable().optional(),
  /** Bill the course fees on one invoice (needs "Create invoices"). */
  invoice: z.boolean().default(true),
  /** Bill by a package in the fee catalogue instead - a bundle's one price. */
  packageId: uuidSchema.nullable().optional(),
  /** Major units off, with the reason, when billing. */
  discount: z.coerce.number().min(0).max(10_000_000).default(0),
  discountReason: optionalText(200),
});
export type EnrolInput = z.input<typeof enrolSchema>;

/**
 * The fees of an enrolment: not billed here, waiting for approval, unpaid,
 * part paid, paid, overdue (money due and late), or the invoice was voided.
 */
export const FEE_STATUSES = ['not_billed', 'pending', 'unpaid', 'part_paid', 'paid', 'overdue', 'void'] as const;
export type FeeStatus = (typeof FEE_STATUSES)[number];
export const FEE_STATUS_LABEL: Record<FeeStatus, string> = {
  not_billed: 'Not billed',
  pending: 'Invoice awaiting approval',
  unpaid: 'Unpaid',
  part_paid: 'Part paid',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Invoice voided',
};
export const FEE_STATUS_TONE: Record<FeeStatus, 'ok' | 'warn' | 'bad' | 'neutral' | 'info'> = {
  not_billed: 'neutral',
  pending: 'info',
  unpaid: 'warn',
  part_paid: 'warn',
  paid: 'ok',
  overdue: 'bad',
  void: 'neutral',
};
export interface EnrollmentFee {
  status: FeeStatus;
  currency: Currency | null;
  /** Minor units. */
  total: number;
  paid: number;
  balance: number;
  dueDate: string | null;
}

/** Owing money: anything billed and not settled. */
export const OWING: readonly FeeStatus[] = ['unpaid', 'part_paid', 'overdue'];

export const transferSchema = z.object({ batchId: uuidSchema, reason: reasonSchema });
export const freezeSchema = z
  .object({ from: dateOnlySchema, until: dateOnlySchema, reason: reasonSchema })
  .refine((v) => v.until >= v.from, { message: 'Back after it starts', path: ['until'] });

export interface EnrollmentView {
  id: string;
  number: string;
  batchId: string;
  batchCode: string;
  courseId: string;
  courseName: string;
  testType: TestType;
  clientId: string;
  clientName: string;
  consultantName: string | null;
  status: EnrollmentStatus;
  waitlistPosition: number | null;
  targetScore: number | null;
  enrolledAt: string;
  frozenFrom: string | null;
  frozenUntil: string | null;
  freezeReason: string | null;
  dropReason: string | null;
  completedAt: string | null;
  certificateNumber: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  /** Where the fees stand, from the invoice and what has been paid on it. Shared by every course on a bundle's invoice. */
  fee: EnrollmentFee;
  /** study_abroad | course_only - the student's programme with the consultancy. */
  programme: 'study_abroad' | 'course_only';
  transferredFromBatch: string | null;
  attendance: { held: number; present: number; late: number; absent: number; excused: number; percent: number | null };
  latestMock: { title: string; overall: number | null; heldOn: string } | null;
}

/* ------------------------------------------------------------------ */
/* Attendance                                                           */
/* ------------------------------------------------------------------ */

export const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'excused'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = { present: 'Present', late: 'Late', absent: 'Absent', excused: 'Excused' };

export const attendanceSchema = z.object({
  marks: z
    .array(z.object({ enrollmentId: uuidSchema, status: z.enum(ATTENDANCE_STATUSES), note: optionalText(200) }))
    .min(1)
    .max(500),
});
export type AttendanceInput = z.input<typeof attendanceSchema>;

/** Attended: present or late. Excused sessions are left out of the rate. */
export function attendancePercent(a: { present: number; late: number; absent: number }): number | null {
  const counted = a.present + a.late + a.absent;
  return counted ? Math.round(((a.present + a.late) / counted) * 100) : null;
}

export interface AttendanceSheet {
  session: SessionView & { batchId: string; batchCode: string; courseName: string };
  rows: { enrollmentId: string; clientName: string; status: AttendanceStatus | null; note: string | null; frozen: boolean }[];
  /** People sitting in on a trial class before deciding to enrol. */
  trials: TrialGuestView[];
}

/* ------------------------------------------------------------------ */
/* Mock tests                                                           */
/* ------------------------------------------------------------------ */

export const ASSESSMENT_KINDS = ['diagnostic', 'mock', 'quiz'] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];
export const ASSESSMENT_KIND_LABEL: Record<AssessmentKind, string> = { diagnostic: 'Starting test', mock: 'Mock test', quiz: 'Quiz' };

export const assessmentSchema = z.object({
  title: z.string().trim().min(2).max(120),
  kind: z.enum(ASSESSMENT_KINDS).default('mock'),
  heldOn: dateOnlySchema,
});
export type AssessmentInput = z.input<typeof assessmentSchema>;

export const scoresInputSchema = z.object({
  scores: z
    .array(
      z.object({
        enrollmentId: uuidSchema,
        scores: scoresSchema,
        /** For tests that report their own overall (PTE, Duolingo...). */
        overall: z.coerce.number().min(0).max(1000).nullable().optional(),
        feedback: optionalText(1000),
      }),
    )
    .min(1)
    .max(500),
});
export type ScoresInput = z.input<typeof scoresInputSchema>;

export interface AssessmentView {
  id: string;
  batchId: string;
  title: string;
  kind: AssessmentKind;
  heldOn: string;
  testType: TestType;
  scores: { enrollmentId: string; clientName: string; scores: Record<string, number | null>; overall: number | null; feedback: string | null }[];
  average: number | null;
}

/* ------------------------------------------------------------------ */
/* Official tests                                                       */
/* ------------------------------------------------------------------ */

export const TEST_RESULT_STATUSES = ['booked', 'taken', 'result', 'cancelled'] as const;
export type TestResultStatus = (typeof TEST_RESULT_STATUSES)[number];
export const TEST_RESULT_STATUS_LABEL: Record<TestResultStatus, string> = { booked: 'Booked', taken: 'Taken, waiting for the result', result: 'Result in', cancelled: 'Cancelled' };

export const testResultSchema = z.object({
  clientId: uuidSchema,
  testType: z.enum(TEST_TYPES.filter((t) => t !== 'none') as [TestType, ...TestType[]]),
  status: z.enum(TEST_RESULT_STATUSES).default('booked'),
  testDate: dateOnlySchema,
  bookedOn: dateOnlySchema.nullable().optional(),
  venue: optionalText(200),
  /** The booking reference, or the score report's number (TRF). */
  reference: optionalText(60),
  scores: scoresSchema.default({}),
  overall: z.coerce.number().min(0).max(1000).nullable().optional(),
  notes: optionalText(1000),
});
export type TestResultInput = z.input<typeof testResultSchema>;

export interface TestResultView {
  id: string;
  clientId: string;
  clientName: string;
  testType: TestType;
  status: TestResultStatus;
  testDate: string;
  bookedOn: string | null;
  venue: string | null;
  reference: string | null;
  scores: Record<string, number | null>;
  overall: number | null;
  expiresOn: string | null;
  expired: boolean;
  documentId: string | null;
  notes: string | null;
  eligibility: Eligibility[];
  recordedByName: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Homework and materials                                               */
/* ------------------------------------------------------------------ */

export const HOMEWORK_KINDS = ['homework', 'material'] as const;
export type HomeworkKind = (typeof HOMEWORK_KINDS)[number];

export const homeworkSchema = z.object({
  kind: z.enum(HOMEWORK_KINDS).default('homework'),
  title: z.string().trim().min(2).max(160),
  instructions: optionalText(4000),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  maxScore: z.coerce.number().min(1).max(1000).nullable().optional(),
});
export type HomeworkInput = z.input<typeof homeworkSchema>;

export const gradeSchema = z.object({
  score: z.coerce.number().min(0).max(1000).nullable().optional(),
  feedback: optionalText(2000),
  /** Sent back to be done again. */
  returned: z.boolean().default(false),
});

export const HOMEWORK_SUBMISSION_STATUSES = ['submitted', 'graded', 'returned'] as const;
export type HomeworkSubmissionStatus = (typeof HOMEWORK_SUBMISSION_STATUSES)[number];

export interface SubmissionView {
  id: string;
  enrollmentId: string;
  clientName: string;
  text: string | null;
  fileName: string | null;
  submittedAt: string;
  late: boolean;
  status: HomeworkSubmissionStatus;
  score: number | null;
  feedback: string | null;
  gradedByName: string | null;
}

export interface HomeworkView {
  id: string;
  batchId: string;
  kind: HomeworkKind;
  title: string;
  instructions: string | null;
  dueAt: string | null;
  maxScore: number | null;
  fileName: string | null;
  createdByName: string | null;
  createdAt: string;
  submitted: number;
  graded: number;
  submissions: SubmissionView[];
}

/* ------------------------------------------------------------------ */
/* Settings, reports, the student's view                                */
/* ------------------------------------------------------------------ */

export const courseSettingsSchema = z.object({
  /** Tell the consultant after this many absences in a row. */
  absenceAlertAfter: z.coerce.number().int().min(1).max(10).default(2),
  /** A certificate needs at least this attendance (percent). */
  certificateMinAttendance: z.coerce.number().int().min(0).max(100).default(75),
});
export type CourseSettingsInput = z.input<typeof courseSettingsSchema>;
export type CourseSettingsView = z.output<typeof courseSettingsSchema>;

export interface CourseReportRow {
  courseId: string;
  courseName: string;
  batches: number;
  enrolled: number;
  completed: number;
  dropped: number;
  attendancePercent: number | null;
  /** First mock to latest mock, on average across students with both. */
  averageImprovement: number | null;
  /** Students with an official result who reached their target. */
  reachedTarget: number;
  withResult: number;
  revenue: { currency: Currency; amount: number }[];
}

export interface MyCoursesView {
  enrollments: (EnrollmentView & {
    batch: Pick<BatchSummaryView, 'days' | 'startTime' | 'endTime' | 'location' | 'onlineLink' | 'startDate' | 'endDate' | 'trainers'>;
    upcoming: { date: string; startTime: string; endTime: string; topic: string | null }[];
    homework: (Omit<HomeworkView, 'submissions'> & { mine: SubmissionView | null })[];
    mocks: { title: string; heldOn: string; scores: Record<string, number | null>; overall: number | null; feedback: string | null }[];
  })[];
  results: TestResultView[];
}

/* ------------------------------------------------------------------ */
/* Enquiries: before someone becomes a student                          */
/* ------------------------------------------------------------------ */

/*
 * The student process, start to finish:
 *   enquiry (walk-in, call, website) -> follow-ups -> a trial class (optional)
 *   -> enrolled in a batch, billed -> taught (attendance, mocks, homework)
 *   -> completed, certificate, official result -> handed over to study abroad
 *   (optional). An enquiry that goes nowhere is closed with a reason.
 */

export const ENQUIRY_SOURCES = ['walk_in', 'phone', 'whatsapp', 'website', 'social', 'referral', 'partner', 'other'] as const;
export type EnquirySource = (typeof ENQUIRY_SOURCES)[number];
export const ENQUIRY_SOURCE_LABEL: Record<EnquirySource, string> = {
  walk_in: 'Walk-in',
  phone: 'Phone call',
  whatsapp: 'WhatsApp',
  website: 'Website form',
  social: 'Social media',
  referral: 'Referral',
  partner: 'Partner',
  other: 'Other',
};

export const ENQUIRY_STATUSES = ['new', 'contacted', 'trial_booked', 'trial_done', 'enrolled', 'lost'] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];
export const ENQUIRY_STATUS_LABEL: Record<EnquiryStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  trial_booked: 'Trial class booked',
  trial_done: 'Trial class done',
  enrolled: 'Enrolled',
  lost: 'Not joining',
};
export const ENQUIRY_STATUS_TONE: Record<EnquiryStatus, 'ok' | 'warn' | 'bad' | 'neutral' | 'info'> = {
  new: 'info',
  contacted: 'neutral',
  trial_booked: 'warn',
  trial_done: 'warn',
  enrolled: 'ok',
  lost: 'bad',
};
/** Still being worked. */
export const OPEN_ENQUIRY: readonly EnquiryStatus[] = ['new', 'contacted', 'trial_booked', 'trial_done'];

export const TRIAL_OUTCOMES = ['attended', 'no_show'] as const;
export type TrialOutcome = (typeof TRIAL_OUTCOMES)[number];
export const TRIAL_OUTCOME_LABEL: Record<TrialOutcome, string> = { attended: 'Attended', no_show: 'Did not come' };

/** Common reasons, offered as a pick-list; anything else is typed. */
export const LOST_REASONS = ['Fee too high', 'Timing does not suit', 'Joined another institute', 'No longer interested', 'Could not reach them'] as const;

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.string().email().safeParse(v).success, 'Enter a valid email address');
const phone = z.string().trim().min(7, 'Phone number looks too short').max(24, 'Phone number looks too long');

export const enquirySchema = z.object({
  fullName: z.string().trim().min(2, 'Enter their name').max(120),
  phone,
  email: optionalEmail,
  city: optionalText(80),
  courseId: uuidSchema.nullable().optional(),
  batchId: uuidSchema.nullable().optional(),
  source: z.enum(ENQUIRY_SOURCES).default('walk_in'),
  studyAbroad: z.boolean().default(false),
  targetScore: z.coerce.number().min(0).max(1000).nullable().optional(),
  assignedTo: uuidSchema.nullable().optional(),
  followUpOn: dateOnlySchema.nullable().optional(),
  notes: optionalText(2000),
  /** An existing client (a study-abroad student who also wants IELTS). */
  clientId: uuidSchema.nullable().optional(),
});
export type EnquiryInput = z.input<typeof enquirySchema>;

/** A call or a note, and when to follow up next. */
export const enquiryContactSchema = z.object({
  kind: z.enum(['call', 'note']).default('note'),
  body: z.string().trim().min(2, 'Write what was said').max(2000),
  followUpOn: dateOnlySchema.nullable().optional(),
});
export type EnquiryContactInput = z.input<typeof enquiryContactSchema>;

export const trialSchema = z.object({ sessionId: uuidSchema });
export const trialOutcomeSchema = z.object({ outcome: z.enum(TRIAL_OUTCOMES), note: optionalText(500) });
export const enquiryLostSchema = z.object({ reason: z.string().trim().min(3, 'Say why they are not joining').max(500) });

/** Enrolling an enquiry: their client record (made now if needed), then the usual enrolment. */
export const convertEnquirySchema = enrolSchema.omit({ clientId: true }).extend({
  /** Needed to make their client record (and portal login) when they have none. */
  email: optionalEmail,
  programme: z.enum(['course_only', 'study_abroad']).default('course_only'),
});
export type ConvertEnquiryInput = z.input<typeof convertEnquirySchema>;

/** The public enquiry form on the consultancy's site. `website` is a trap for bots and must stay empty. */
export const publicEnquirySchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name').max(120),
  phone,
  email: optionalEmail,
  city: optionalText(80),
  courseId: uuidSchema.nullable().optional(),
  batchId: uuidSchema.nullable().optional(),
  studyAbroad: z.boolean().default(false),
  message: optionalText(1000),
  website: z.string().max(0).optional().default(''),
});
export type PublicEnquiryInput = z.input<typeof publicEnquirySchema>;

const flag = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => v === true || v === 'true' || v === '1');

export const listEnquiriesQuerySchema = z.object({
  /** open (default), all, or one status */
  status: z.union([z.enum(ENQUIRY_STATUSES), z.enum(['open', 'all'])]).default('open'),
  courseId: uuidSchema.optional(),
  /** Only those assigned to me. */
  mine: flag,
  /** Only those whose follow-up is today or earlier. */
  due: flag,
  q: z.string().trim().max(120).optional(),
});
export type ListEnquiriesQuery = z.input<typeof listEnquiriesQuerySchema>;

export interface EnquiryView {
  id: string;
  number: string;
  fullName: string;
  phone: string;
  email: string | null;
  city: string | null;
  course: { id: string; name: string } | null;
  batch: { id: string; code: string; startDate: string } | null;
  source: EnquirySource;
  status: EnquiryStatus;
  studyAbroad: boolean;
  targetScore: number | null;
  assignedTo: { id: string; name: string } | null;
  followUpOn: string | null;
  /** The follow-up date is today or has passed, on an open enquiry. */
  followUpDue: boolean;
  trial: { sessionId: string; batchId: string; batchCode: string; date: string; startTime: string; endTime: string; outcome: TrialOutcome | null } | null;
  lostReason: string | null;
  client: { id: string; name: string; programme: 'study_abroad' | 'course_only' } | null;
  enrollment: { id: string; number: string; batchCode: string } | null;
  notes: string | null;
  lastContactAt: string | null;
  createdAt: string;
  createdByName: string | null;
}

export interface EnquiryEventView {
  id: string;
  kind: string;
  body: string;
  byName: string | null;
  at: string;
}

export interface EnquiryDetail extends EnquiryView {
  events: EnquiryEventView[];
}

export interface EnquirySummary {
  /** Open enquiries by status. */
  open: Record<'new' | 'contacted' | 'trial_booked' | 'trial_done', number>;
  /** Open enquiries whose follow-up is today or earlier. */
  followUpsDue: number;
  /** Over the last 90 days: how many came in, enrolled and were let go. */
  last90: { received: number; enrolled: number; lost: number; conversionPercent: number | null };
  bySource: { source: EnquirySource; received: number; enrolled: number }[];
}

/** A class a trial guest can sit in on: the next few weeks of open batches. */
export interface TrialSlotView {
  sessionId: string;
  batchId: string;
  batchCode: string;
  courseId: string;
  courseName: string;
  date: string;
  startTime: string;
  endTime: string;
  guests: number;
}

/** Trial guests sitting in on a session, shown on its attendance sheet. */
export interface TrialGuestView {
  enquiryId: string;
  number: string;
  fullName: string;
  phone: string;
  outcome: TrialOutcome | null;
}

/** What the public enquiry form offers. */
export interface PublicCoursesView {
  consultancy: string;
  courses: {
    id: string;
    name: string;
    testType: TestType;
    mode: CourseMode;
    durationWeeks: number;
    batches: { id: string; code: string; startDate: string; days: number[]; startTime: string; endTime: string; seatsLeft: number }[];
  }[];
}

/* ------------------------------------------------------------------ */
/* Every course student, across batches                                 */
/* ------------------------------------------------------------------ */

export const STUDENT_LIST_STATUSES = ['current', 'upcoming', 'running', 'waitlisted', 'frozen', 'completed', 'dropped', 'all'] as const;
export type StudentListStatus = (typeof STUDENT_LIST_STATUSES)[number];
export const STUDENT_LIST_STATUS_LABEL: Record<StudentListStatus, string> = {
  current: 'Current',
  upcoming: 'Starting soon',
  running: 'In class',
  waitlisted: 'Waiting for a seat',
  frozen: 'Paused',
  completed: 'Completed',
  dropped: 'Dropped',
  all: 'All',
};

export const listStudentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().max(120).optional(),
  courseId: uuidSchema.optional(),
  batchId: uuidSchema.optional(),
  status: z.enum(STUDENT_LIST_STATUSES).default('current'),
  /** owing (unpaid, part paid or overdue), overdue, paid, not_billed */
  fees: z.enum(['owing', 'overdue', 'paid', 'not_billed']).optional(),
  programme: z.enum(['study_abroad', 'course_only']).optional(),
  /** Finished a course, course-only, not handed over yet: who to offer study abroad. */
  handOver: flag,
});
export type ListStudentsQuery = z.input<typeof listStudentsQuerySchema>;

export interface StudentListView {
  items: EnrollmentView[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** Still owed across the whole filtered list, per currency. */
  owing: { currency: Currency; amount: number }[];
}

/** Passing a course-only student to the study-abroad side. */
export const handOverSchema = z.object({
  /** The consultant who takes them on; their current one when left out. */
  consultantId: uuidSchema.nullable().optional(),
  note: optionalText(1000),
});
export type HandOverInput = z.input<typeof handOverSchema>;
