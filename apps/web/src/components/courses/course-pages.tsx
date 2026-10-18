import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  localIsoDate,
  ASSESSMENT_KIND_LABEL,
  ATTENDANCE_STATUS_LABEL,
  BATCH_STATUS_LABEL,
  BATCH_STATUS_TONE,
  COURSE_LEVEL_LABEL,
  COURSE_MODE_LABEL,
  ENROLLMENT_STATUS_LABEL,
  ENROLLMENT_STATUS_TONE,
  FEE_STATUS_LABEL,
  FEE_STATUS_TONE,
  OWING,
  TEST_RESULT_STATUS_LABEL,
  TEST_SCALES,
  TEST_TYPE_LABEL,
  WEEKDAYS,
  formatMoney,
  type AssessmentView,
  type AttendanceSheet,
  type AuthUser,
  type BatchSummaryView,
  type BatchView,

  type CourseReportRow,
  type EnrollmentFee,
  type CourseSettingsView,
  type CourseView,
  type EnrollmentView,
  type HomeworkView,
  type MyCoursesView,
  type Paginated,
  type ServicePackageView,
  type TestResultView,
} from '@crm/shared';
import { ApiError, apiFetch, qs } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { enabledModules } from '@/lib/entitlements';
import { Card, EmptyState, LinkButton, PageHeader, Panel, Pill, cx } from '../ui';
import { NoAccess } from '../no-access';
import { IconPlus, IconPrinter } from '../icons';
import { MoneyTable } from '../finance/workspace';
import { SwitchTabs } from '../partners/partner-forms';
import {
  AddAssessment,
  AddHomework,
  AttendanceForm,
  BatchForm,
  CompleteBatch,
  CourseForm,
  CourseSettingsForm,
  EnrolForm,
  EnrollmentActions,
  GradeSubmission,
  ScoresGrid,
  SessionEdit,
  SubmitHomework,
  TestResultForm,
} from './course-forms';
import { HandOverForm, TrialOutcomeButtons } from './enquiry-forms';

export const coursesBase = (user: AuthUser) => (user.role === 'manager' ? '/overview/courses' : '/desk/courses');
const clientsBase = (user: AuthUser) => (user.role === 'manager' ? '/overview/clients' : '/desk/clients');
/** Only people who can open any client get a link to one; a trainer would land on "not found". */
const opensClients = (user: AuthUser) => user.role === 'manager' || can(user, 'client.view_all');
const sees = (user: AuthUser) => can(user, 'course.view') || can(user, 'course.teach');
const schedule = (b: Pick<BatchSummaryView, 'days' | 'startTime' | 'endTime'>) => `${b.days.map((d) => WEEKDAYS[d]).join('/')} ${b.startTime}-${b.endTime}`;

async function load<T>(path: string): Promise<T> {
  try {
    return await apiFetch<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
}

type Section = 'courses' | 'enquiries' | 'students' | 'batches' | 'results' | 'report' | 'settings';
export function Tabs({ user, active }: { user: AuthUser; active: Section }) {
  const base = coursesBase(user);
  return (
    <SwitchTabs
      active={active}
      tabs={[
        ...(can(user, 'course.view') ? [{ key: 'courses', label: 'Courses', href: base }] : []),
        ...(can(user, 'course.view') || can(user, 'course.enroll') ? [{ key: 'enquiries', label: 'Enquiries', href: `${base}/enquiries` }] : []),
        { key: 'students', label: can(user, 'course.view') ? 'Students' : 'My students', href: `${base}/students` },
        { key: 'batches', label: can(user, 'course.view') ? 'Batches' : 'My batches', href: `${base}/batches` },
        ...(can(user, 'course.view') ? [{ key: 'results', label: 'Test results', href: `${base}/results` }] : []),
        ...(can(user, 'course.view') ? [{ key: 'report', label: 'Report', href: `${base}/report` }] : []),
        ...(can(user, 'course.manage') ? [{ key: 'settings', label: 'Settings', href: `${base}/settings` }] : []),
      ]}
    />
  );
}

export const coursePackages = () =>
  apiFetch<ServicePackageView[]>('/billing/packages')
    .then((l) => l.filter((p) => p.category === 'course' && p.active).map((p) => ({ id: p.id, name: `${p.name} (${formatMoney(p.amount, p.currency)})` })))
    .catch(() => []);

/* ------------------------------------------------------------------ */
/* The catalogue                                                        */
/* ------------------------------------------------------------------ */

export async function CoursesPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!sees(user)) return <NoAccess title="Courses" permission="course.view" />;
  if (!can(user, 'course.view')) return <BatchesPage user={user} query={{ mine: '1' }} />;
  const base = coursesBase(user);
  const all = query.all === '1';
  const list = await apiFetch<CourseView[]>(`/courses${qs({ all: all ? 'true' : undefined })}`);
  return (
    <>
      <PageHeader
        title="Courses"
        subtitle="IELTS, PTE and every other course you teach: the catalogue, its batches, who is enrolled and how they are doing."
        actions={
          can(user, 'course.manage') ? (
            <LinkButton href={`${base}/new`}>
              <IconPlus size={16} />
              Add course
            </LinkButton>
          ) : undefined
        }
      />
      <Tabs user={user} active="courses" />
      <div className="mb-3">
        <Link href={`${base}${qs({ all: all ? undefined : '1' })}`} className="text-[12.5px] font-medium text-brand-700 hover:underline">
          {all ? 'Hide courses no longer offered' : 'Show courses no longer offered'}
        </Link>
      </div>
      {list.length === 0 ? (
        <Card>
          <EmptyState title="No courses yet" description="Add the courses you teach - IELTS, PTE, spoken English - then run batches of them." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((c) => (
            <Link key={c.id} href={`${base}/${c.id}`} className={cx('block rounded-xl bg-paper p-4 shadow-card transition hover:shadow-md', !c.active && 'opacity-60')}>
              <p className="text-[12px] font-medium uppercase tracking-wide text-ink-400">{c.code}</p>
              <p className="text-[16px] font-medium text-ink-950">{c.name}</p>
              <p className="mt-1 text-[12.5px] text-ink-500">
                {TEST_TYPE_LABEL[c.testType]} · {COURSE_MODE_LABEL[c.mode]} · {c.durationWeeks} weeks, {c.hoursPerWeek} h a week
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
                <Pill tone="info">{c.batches.running} running</Pill>
                <Pill tone="neutral">{c.batches.upcoming} coming up</Pill>
                <span className="text-ink-500">{c.students} students</span>
                <span className="ml-auto font-medium text-ink-900">{c.packageName ?? (c.fee ? formatMoney(c.fee, c.currency) : 'No fee')}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export async function NewCoursePage({ user }: { user: AuthUser }) {
  if (!can(user, 'course.manage')) return <NoAccess title="Add a course" permission="course.manage" />;
  const base = coursesBase(user);
  return (
    <>
      <PageHeader title="Add a course" breadcrumb={[{ href: base, label: 'Courses' }, { label: 'New' }]} />
      <Card className="max-w-3xl p-5">
        <CourseForm initial={null} base={base} packages={await coursePackages()} />
      </Card>
    </>
  );
}

export async function CoursePage({ user, id }: { user: AuthUser; id: string }) {
  if (!sees(user)) return <NoAccess title="Courses" permission="course.view" />;
  const base = coursesBase(user);
  const [c, batches] = await Promise.all([load<CourseView>(`/courses/${id}`), apiFetch<BatchSummaryView[]>(`/courses/batches${qs({ courseId: id, status: 'all' })}`)]);
  const manage = can(user, 'course.manage');
  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={`${c.code} · ${TEST_TYPE_LABEL[c.testType]} · ${COURSE_LEVEL_LABEL[c.level]} · ${COURSE_MODE_LABEL[c.mode]}`}
        breadcrumb={[{ href: base, label: 'Courses' }, { label: c.name }]}
        actions={
          manage ? (
            <LinkButton href={`${base}/batches/new?courseId=${c.id}`}>
              <IconPlus size={16} />
              New batch
            </LinkButton>
          ) : undefined
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title="Batches" bodyClassName="">
          <BatchTable batches={batches} base={base} />
        </Panel>
        {manage && (
          <Panel title="Details">
            <CourseForm initial={c} base={base} packages={await coursePackages()} />
          </Panel>
        )}
      </div>
    </>
  );
}

function BatchTable({ batches, base }: { batches: BatchSummaryView[]; base: string }) {
  if (!batches.length) return <p className="px-5 pb-5 text-[13px] text-ink-400">No batches yet.</p>;
  return (
    <MoneyTable head={['Batch', 'Dates', 'Timetable', 'Trainers', 'Status', { label: 'Seats', right: true }]}>
      {batches.map((b) => (
        <tr key={b.id} className="border-t border-line hover:bg-ink-50/60">
          <td className="px-4 py-2.5">
            <Link href={`${base}/batches/${b.id}`} className="font-medium text-ink-950 hover:text-brand-700">
              {b.code}
            </Link>
            <span className="block text-[11.5px] text-ink-400">{b.courseName}</span>
          </td>
          <td className="px-4 py-2.5 text-ink-600">
            {formatDate(b.startDate)} to {formatDate(b.endDate)}
          </td>
          <td className="px-4 py-2.5 text-ink-600">
            {schedule(b)}
            <span className="block text-[11.5px] text-ink-400">{b.location ?? (b.onlineLink ? 'Online' : '')}</span>
          </td>
          <td className="px-4 py-2.5 text-ink-600">{b.trainers.map((t) => t.name).join(', ') || '–'}</td>
          <td className="px-4 py-2.5">
            <Pill tone={BATCH_STATUS_TONE[b.status]}>{BATCH_STATUS_LABEL[b.status]}</Pill>
            <span className="block text-[11.5px] text-ink-400">
              {b.sessionsHeld} of {b.sessionsTotal} sessions
            </span>
          </td>
          <td className="tnum px-4 py-2.5 text-right">
            {b.enrolled}/{b.capacity}
            {b.waitlisted ? <span className="block text-[11.5px] text-warn-700">{b.waitlisted} waiting</span> : null}
          </td>
        </tr>
      ))}
    </MoneyTable>
  );
}

/* ------------------------------------------------------------------ */
/* Batches                                                              */
/* ------------------------------------------------------------------ */

export async function BatchesPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!sees(user)) return <NoAccess title="Courses" permission="course.view" />;
  const base = coursesBase(user);
  const status = ['current', 'all', 'completed', 'cancelled'].includes(query.status ?? '') ? query.status! : 'current';
  const mine = query.mine === '1' || !can(user, 'course.view');
  const batches = await apiFetch<BatchSummaryView[]>(`/courses/batches${qs({ status, mine: mine ? 'true' : undefined })}`);
  return (
    <>
      <PageHeader
        title={mine ? 'My batches' : 'Batches'}
        subtitle={mine ? 'The batches you teach.' : 'Every run of every course.'}
        actions={
          can(user, 'course.manage') ? (
            <LinkButton href={`${base}/batches/new`}>
              <IconPlus size={16} />
              New batch
            </LinkButton>
          ) : undefined
        }
      />
      <Tabs user={user} active="batches" />
      <div className="mb-3 flex flex-wrap gap-2">
        {(['current', 'completed', 'cancelled', 'all'] as const).map((s) => (
          <Link key={s} href={`${base}/batches${qs({ status: s, mine: query.mine })}`} className={cx('rounded-full px-3 py-1 text-[12.5px] font-medium', status === s ? 'bg-ink-900 text-paper' : 'bg-ink-100 text-ink-600 hover:bg-ink-200')}>
            {s === 'current' ? 'Current' : s === 'all' ? 'All' : BATCH_STATUS_LABEL[s]}
          </Link>
        ))}
        {can(user, 'course.view') && can(user, 'course.teach') && (
          <Link href={`${base}/batches${qs({ status, mine: mine ? undefined : '1' })}`} className={cx('ml-auto rounded-full px-3 py-1 text-[12.5px] font-medium', mine ? 'bg-brand-600 text-paper' : 'bg-ink-100 text-ink-600')}>
            Only the ones I teach
          </Link>
        )}
      </div>
      <Card className="overflow-hidden">
        {batches.length === 0 ? <EmptyState title="No batches" description={mine ? 'You are not teaching a batch at the moment.' : 'Run a batch of a course to start enrolling students.'} /> : <BatchTable batches={batches} base={base} />}
      </Card>
    </>
  );
}

export async function NewBatchPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!can(user, 'course.manage')) return <NoAccess title="New batch" permission="course.manage" />;
  const base = coursesBase(user);
  const [courses, trainers] = await Promise.all([apiFetch<CourseView[]>('/courses'), apiFetch<{ id: string; name: string }[]>('/courses/trainers')]);
  return (
    <>
      <PageHeader title="New batch" breadcrumb={[{ href: base, label: 'Courses' }, { href: `${base}/batches`, label: 'Batches' }, { label: 'New' }]} />
      <Card className="max-w-3xl p-5">
        {courses.length === 0 ? <p className="text-[13px] text-ink-500">Add a course first.</p> : <BatchForm initial={null} courses={courses} trainers={trainers} base={base} courseId={query.courseId} />}
      </Card>
    </>
  );
}

const BATCH_TABS = ['roster', 'sessions', 'scores', 'homework', 'details'] as const;

export async function BatchPage({ user, id, tab: raw }: { user: AuthUser; id: string; tab?: string }) {
  if (!sees(user)) return <NoAccess title="Courses" permission="course.view" />;
  const base = coursesBase(user);
  const tab = (BATCH_TABS as readonly string[]).includes(raw ?? '') ? raw! : 'roster';
  const b = await load<BatchView>(`/courses/batches/${id}`);
  const manage = can(user, 'course.manage');
  const teaches = manage || (can(user, 'course.teach') && b.trainers.some((t) => t.userId === user.id));
  const enrol = can(user, 'course.enroll') || manage;
  return (
    <>
      <PageHeader
        title={`${b.code} · ${b.courseName}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Pill tone={BATCH_STATUS_TONE[b.status]}>{BATCH_STATUS_LABEL[b.status]}</Pill>
            <span>
              {formatDate(b.startDate)} to {formatDate(b.endDate)} · {schedule(b)} · {b.location ?? 'Online'} · {b.enrolled}/{b.capacity} seats
              {b.waitlisted ? `, ${b.waitlisted} waiting` : ''} · {b.trainers.map((t) => t.name).join(', ') || 'no trainer yet'}
            </span>
          </span>
        }
        breadcrumb={[{ href: base, label: 'Courses' }, { href: `${base}/batches`, label: 'Batches' }, { label: b.code }]}
        actions={
          <>
            {enrol && b.status !== 'completed' && b.status !== 'cancelled' && <LinkButton href={`${base}/enrol?batchId=${b.id}`}>Enrol a student</LinkButton>}
            {manage && b.status !== 'completed' && <CompleteBatch batchId={b.id} />}
          </>
        }
      />
      <SwitchTabs active={tab} tabs={BATCH_TABS.map((t) => ({ key: t, label: { roster: 'Students', sessions: 'Sessions and attendance', scores: 'Mock tests', homework: 'Homework and materials', details: 'Details' }[t], href: `${base}/batches/${id}?tab=${t}` }))} />
      {tab === 'roster' && <RosterTab user={user} b={b} />}
      {tab === 'sessions' && <SessionsTab user={user} b={b} teaches={teaches} />}
      {tab === 'scores' && <ScoresTab b={b} teaches={teaches} />}
      {tab === 'homework' && <HomeworkTab b={b} teaches={teaches} />}
      {tab === 'details' && <DetailsTab user={user} b={b} />}
    </>
  );
}

function RosterTab({ user, b }: { user: AuthUser; b: BatchView }) {
  const base = coursesBase(user);
  if (!b.roster.length) return <Card><EmptyState title="Nobody yet" description="Enrol students from here or from their own page." /></Card>;
  return (
    <Card className="overflow-hidden">
      <MoneyTable head={['Student', 'Status', 'Attendance', 'Latest mock', 'Target', 'Fees']}>
        {b.roster.map((e) => (
          <tr key={e.id} className="border-t border-line">
            <td className="px-4 py-2.5">
              <Link href={`${base}/enrollments/${e.id}`} className="font-medium text-ink-950 hover:text-brand-700">
                {e.clientName}
              </Link>
              <span className="block text-[11.5px] text-ink-400">
                {e.number}
                {e.consultantName ? ` · ${e.consultantName}` : ''}
              </span>
            </td>
            <td className="px-4 py-2.5">
              <Pill tone={ENROLLMENT_STATUS_TONE[e.status]}>{e.status === 'waitlisted' ? `Waiting #${e.waitlistPosition}` : ENROLLMENT_STATUS_LABEL[e.status]}</Pill>
              {e.status === 'frozen' && <span className="block text-[11.5px] text-ink-400">back {formatDate(e.frozenUntil)}</span>}
            </td>
            <td className="tnum px-4 py-2.5">{e.attendance.percent === null ? '–' : <span className={cx(e.attendance.percent < 75 && 'text-warn-700')}>{e.attendance.percent}%</span>}</td>
            <td className="tnum px-4 py-2.5">{e.latestMock ? `${e.latestMock.overall ?? '–'} (${e.latestMock.title})` : '–'}</td>
            <td className="tnum px-4 py-2.5">{e.targetScore ?? '–'}</td>
            <td className="px-4 py-2.5 text-[12.5px] text-ink-600">
              <Pill tone={FEE_STATUS_TONE[e.fee.status]}>{FEE_STATUS_LABEL[e.fee.status]}</Pill>
              {e.fee.balance > 0 && e.fee.currency && OWING.includes(e.fee.status) ? <span className="tnum block text-[11.5px] text-ink-500">{formatMoney(e.fee.balance, e.fee.currency)} to pay</span> : null}
            </td>
          </tr>
        ))}
      </MoneyTable>
    </Card>
  );
}

function SessionsTab({ user, b, teaches }: { user: AuthUser; b: BatchView; teaches: boolean }) {
  const base = coursesBase(user);
  const day = localIsoDate();
  return (
    <Card className="overflow-hidden">
      {b.sessions.length === 0 ? (
        <EmptyState title="No sessions" description="Sessions come from the batch's timetable." />
      ) : (
        <MoneyTable head={['Date', 'Time', 'Topic', 'Attendance', '']}>
          {b.sessions.map((s) => (
            <tr key={s.id} className={cx('border-t border-line', s.cancelled && 'opacity-50')}>
              <td className="px-4 py-2.5 text-ink-900">
                {formatDate(s.date)} <span className="text-[11.5px] text-ink-400">{WEEKDAYS[new Date(`${s.date}T00:00:00Z`).getUTCDay()]}</span>
              </td>
              <td className="px-4 py-2.5 text-ink-600">
                {s.startTime}-{s.endTime}
              </td>
              <td className="px-4 py-2.5">{teaches ? <SessionEdit sessionId={s.id} topic={s.topic} cancelled={s.cancelled} /> : (s.topic ?? '–')}</td>
              <td className="tnum px-4 py-2.5 text-ink-600">{s.cancelled ? 'Cancelled' : s.marked ? `${s.present} of ${s.marked}` : s.date <= day ? <span className="text-warn-700">Not taken</span> : '–'}</td>
              <td className="px-4 py-2.5 text-right">
                {!s.cancelled && (
                  <Link href={`${base}/sessions/${s.id}`} className="text-[12.5px] font-medium text-brand-700 hover:underline">
                    {teaches && s.date <= day ? 'Take attendance' : 'Open'}
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </MoneyTable>
      )}
    </Card>
  );
}

async function ScoresTab({ b, teaches }: { b: BatchView; teaches: boolean }) {
  const list = await apiFetch<AssessmentView[]>(`/courses/batches/${b.id}/assessments`);
  const roster = b.roster.filter((e) => e.status === 'enrolled' || e.status === 'frozen' || e.status === 'completed').map((e) => ({ enrollmentId: e.id, clientName: e.clientName }));
  return (
    <div className="space-y-5">
      {teaches && (
        <Panel title="A new mock test">
          <AddAssessment batchId={b.id} />
        </Panel>
      )}
      {list.length === 0 && (
        <Card>
          <EmptyState title="No mock tests yet" description={`Scores are entered on the ${TEST_SCALES[b.testType].modules.map((m) => m.label.toLowerCase()).join(', ')} scale of ${TEST_SCALES[b.testType].min}-${TEST_SCALES[b.testType].max}.`} />
        </Card>
      )}
      {[...list].reverse().map((a) => (
        <Panel key={a.id} title={`${a.title}`} subtitle={`${ASSESSMENT_KIND_LABEL[a.kind]} · ${formatDate(a.heldOn)}${a.average !== null ? ` · average ${a.average}` : ''}`}>
          <ScoresGrid assessment={a} roster={roster} canRecord={teaches} />
        </Panel>
      ))}
    </div>
  );
}

async function HomeworkTab({ b, teaches }: { b: BatchView; teaches: boolean }) {
  const list = await apiFetch<HomeworkView[]>(`/courses/batches/${b.id}/homework`);
  return (
    <div className="space-y-5">
      {teaches && <AddHomework batchId={b.id} />}
      {list.length === 0 && (
        <Card>
          <EmptyState title="Nothing set yet" description="Set homework (students hand it in from their portal) or share materials with the batch." />
        </Card>
      )}
      {list.map((h) => (
        <Panel
          key={h.id}
          title={h.title}
          subtitle={`${h.kind === 'material' ? 'Material' : `Homework${h.dueAt ? ` · due ${formatDate(h.dueAt)}` : ''}${h.maxScore ? ` · out of ${h.maxScore}` : ''} · ${h.submitted} handed in, ${h.graded} marked`}`}
          action={
            h.fileName ? (
              <a href={`/api/courses/homework/${h.id}/file`} className="text-[12.5px] font-medium text-brand-700 hover:underline">
                {h.fileName}
              </a>
            ) : undefined
          }
        >
          {h.instructions && <p className="mb-3 whitespace-pre-line text-[13px] text-ink-700">{h.instructions}</p>}
          {h.kind === 'homework' && (
            <div className="divide-y divide-line">
              {h.submissions.length === 0 && <p className="text-[13px] text-ink-400">Nothing handed in yet.</p>}
              {h.submissions.map((s) => (
                <div key={s.id} className="py-2.5 text-[13px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink-900">
                      {s.clientName}
                      <span className="font-normal text-ink-400">
                        {' '}
                        · {formatDate(s.submittedAt)}
                        {s.late ? ' · late' : ''}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {s.fileName && (
                        <a href={`/api/courses/submissions/${s.id}/file`} className="text-[12.5px] text-brand-700 hover:underline">
                          {s.fileName}
                        </a>
                      )}
                      <Pill tone={s.status === 'graded' ? 'ok' : s.status === 'returned' ? 'warn' : 'info'}>{s.status === 'graded' ? `Marked${s.score !== null ? `: ${s.score}` : ''}` : s.status === 'returned' ? 'Sent back' : 'To mark'}</Pill>
                    </span>
                  </div>
                  {s.text && <p className="mt-1 line-clamp-4 whitespace-pre-line text-ink-600">{s.text}</p>}
                  {s.feedback && <p className="mt-1 text-[12.5px] text-ink-500">Feedback: {s.feedback}</p>}
                  {teaches && s.status === 'submitted' && <GradeSubmission id={s.id} maxScore={h.maxScore} />}
                </div>
              ))}
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}

async function DetailsTab({ user, b }: { user: AuthUser; b: BatchView }) {
  const base = coursesBase(user);
  if (!can(user, 'course.manage')) {
    return (
      <Panel title="Details">
        <p className="text-[13px] text-ink-700">{b.notes ?? 'No notes.'}</p>
        {b.onlineLink && (
          <a href={b.onlineLink} className="mt-2 block text-[13px] text-brand-700 hover:underline" target="_blank" rel="noreferrer">
            {b.onlineLink}
          </a>
        )}
      </Panel>
    );
  }
  const [courses, trainers] = await Promise.all([apiFetch<CourseView[]>('/courses?all=true'), apiFetch<{ id: string; name: string }[]>('/courses/trainers')]);
  return (
    <Card className="max-w-3xl p-5">
      <BatchForm initial={b} courses={courses} trainers={trainers} base={base} />
    </Card>
  );
}

export async function SessionPage({ user, id }: { user: AuthUser; id: string }) {
  if (!sees(user)) return <NoAccess title="Courses" permission="course.view" />;
  const base = coursesBase(user);
  const sheet = await load<AttendanceSheet>(`/courses/sessions/${id}/attendance`);
  const batch = await load<BatchView>(`/courses/batches/${sheet.session.batchId}`);
  const canMark = can(user, 'course.manage') || (can(user, 'course.teach') && batch.trainers.some((t) => t.userId === user.id));
  return (
    <>
      <PageHeader
        title={`Attendance · ${formatDate(sheet.session.date)}`}
        subtitle={`${sheet.session.batchCode} · ${sheet.session.courseName} · ${sheet.session.startTime}-${sheet.session.endTime}${sheet.session.topic ? ` · ${sheet.session.topic}` : ''}`}
        breadcrumb={[{ href: `${base}/batches`, label: 'Batches' }, { href: `${base}/batches/${sheet.session.batchId}?tab=sessions`, label: sheet.session.batchCode }, { label: formatDate(sheet.session.date) }]}
      />
      <Card className="max-w-3xl p-5">
        {sheet.rows.length === 0 ? <p className="text-[13px] text-ink-400">Nobody is enrolled.</p> : <AttendanceForm sheet={sheet} canMark={canMark} />}
      </Card>
      {sheet.trials.length > 0 && (
        <Panel className="mt-5 max-w-3xl" title="Trial guests" subtitle="Sitting in before deciding to enrol. Say whether they came - whoever follows them up is told.">
          <div className="divide-y divide-line">
            {sheet.trials.map((t) => (
              <div key={t.enquiryId} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-[13px]">
                <span>
                  {can(user, 'course.view') || can(user, 'course.enroll') ? (
                    <Link href={`${base}/enquiries/${t.enquiryId}`} className="font-medium text-ink-900 hover:text-brand-700">
                      {t.fullName}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink-900">{t.fullName}</span>
                  )}
                  <span className="block text-[11.5px] text-ink-400">
                    {t.number} · {t.phone}
                  </span>
                </span>
                {sheet.session.date <= localIsoDate() && (canMark || can(user, 'course.enroll')) ? (
                  <TrialOutcomeButtons id={t.enquiryId} outcome={t.outcome} />
                ) : (
                  <Pill tone={t.outcome === 'attended' ? 'ok' : t.outcome === 'no_show' ? 'bad' : 'neutral'}>{t.outcome === 'attended' ? 'Came' : t.outcome === 'no_show' ? 'Did not come' : 'Expected'}</Pill>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Enrolments                                                           */
/* ------------------------------------------------------------------ */

export async function EnrolPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!can(user, 'course.enroll') && !can(user, 'course.manage')) return <NoAccess title="Enrol a student" permission="course.enroll" />;
  const base = coursesBase(user);
  const [batches, clients, packages] = await Promise.all([
    apiFetch<BatchSummaryView[]>('/courses/batches?status=current'),
    query.clientId ? Promise.resolve(null) : apiFetch<Paginated<{ id: string; fullName: string }>>('/clients?pageSize=100'),
    can(user, 'billing.invoice') ? coursePackages() : Promise.resolve([]),
  ]);
  const ordered = query.batchId ? [...batches.filter((b) => b.id === query.batchId), ...batches.filter((b) => b.id !== query.batchId)] : batches;
  const done = query.clientId ? `${clientsBase(user)}/${query.clientId}` : query.batchId ? `${base}/batches/${query.batchId}` : `${base}/batches`;
  return (
    <>
      <PageHeader title="Enrol a student" subtitle="One batch, or several billed together as a bundle." breadcrumb={[{ href: `${base}/batches`, label: 'Batches' }, { label: 'Enrol' }]} />
      <Card className="max-w-3xl p-5">
        <EnrolForm clientId={query.clientId ?? null} clients={(clients?.items ?? []).map((c) => ({ id: c.id, name: c.fullName }))} batches={ordered} packages={packages} canBill={can(user, 'billing.invoice')} done={done} />
      </Card>
    </>
  );
}

export async function EnrollmentPage({ user, id }: { user: AuthUser; id: string }) {
  if (!sees(user)) return <NoAccess title="Courses" permission="course.view" />;
  const base = coursesBase(user);
  const e = await load<EnrollmentView>(`/courses/enrollments/${id}`);
  const [assessments, batches, modules] = await Promise.all([
    apiFetch<AssessmentView[]>(`/courses/batches/${e.batchId}/assessments`).catch(() => []),
    apiFetch<BatchSummaryView[]>('/courses/batches?status=current'),
    enabledModules(),
  ]);
  const mine = assessments
    .map((a) => ({ title: a.title, heldOn: a.heldOn, ...a.scores.find((s) => s.enrollmentId === id) }))
    .filter((a): a is { title: string; heldOn: string; enrollmentId: string; clientName: string; scores: Record<string, number | null>; overall: number | null; feedback: string | null } => Boolean(a.enrollmentId));
  return (
    <>
      <PageHeader
        title={`${e.clientName} · ${e.courseName}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Pill tone={ENROLLMENT_STATUS_TONE[e.status]}>{ENROLLMENT_STATUS_LABEL[e.status]}</Pill>
            <span>
              {e.number} · <Link href={`${base}/batches/${e.batchId}`} className="text-brand-700 hover:underline">{e.batchCode}</Link>
              {e.transferredFromBatch ? ` · moved from ${e.transferredFromBatch}` : ''}
              {e.targetScore ? ` · aiming for ${e.targetScore}` : ''}
              {e.invoiceNumber ? ` · billed on ${e.invoiceNumber}` : ''}
            </span>
          </span>
        }
        breadcrumb={[{ href: `${base}/batches`, label: 'Batches' }, { href: `${base}/batches/${e.batchId}`, label: e.batchCode }, { label: e.clientName }]}
        actions={
          e.certificateNumber ? (
            <a href={`/api/courses/enrollments/${e.id}/certificate`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink-700 hover:bg-ink-50">
              <IconPrinter size={15} />
              Certificate {e.certificateNumber}
            </a>
          ) : undefined
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Panel title="Mock test scores" subtitle={mine.length >= 2 ? `From ${mine[0]!.overall ?? '–'} to ${mine[mine.length - 1]!.overall ?? '–'}` : undefined}>
            {mine.length === 0 ? (
              <p className="text-[13px] text-ink-400">No scores yet.</p>
            ) : (
              <>
                <ScoreChart points={mine.map((m) => ({ label: m.title, value: m.overall }))} max={TEST_SCALES[e.testType].overall === 'sum' ? TEST_SCALES[e.testType].max * 4 : TEST_SCALES[e.testType].max} target={e.targetScore} />
                <MoneyTable head={['Test', ...TEST_SCALES[e.testType].modules.map((m) => ({ label: m.label, right: true })), { label: 'Overall', right: true }]} className="mt-3">
                  {mine.map((m) => (
                    <tr key={m.title + m.heldOn} className="border-t border-line">
                      <td className="px-4 py-2 text-ink-800">
                        {m.title}
                        <span className="block text-[11.5px] text-ink-400">
                          {formatDate(m.heldOn)}
                          {m.feedback ? ` · ${m.feedback}` : ''}
                        </span>
                      </td>
                      {TEST_SCALES[e.testType].modules.map((mod) => (
                        <td key={mod.key} className="tnum px-4 py-2 text-right">
                          {m.scores[mod.key] ?? '–'}
                        </td>
                      ))}
                      <td className="tnum px-4 py-2 text-right font-semibold">{m.overall ?? '–'}</td>
                    </tr>
                  ))}
                </MoneyTable>
              </>
            )}
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Attendance">
            <p className="tnum text-[24px] font-semibold text-ink-950">{e.attendance.percent === null ? '–' : `${e.attendance.percent}%`}</p>
            <p className="text-[12.5px] text-ink-500">
              {(['present', 'late', 'absent', 'excused'] as const).map((k) => `${e.attendance[k]} ${ATTENDANCE_STATUS_LABEL[k].toLowerCase()}`).join(' · ')}
            </p>
          </Panel>
          <Panel title="Fees">
            <FeeSummary fee={e.fee} invoiceId={e.invoiceId} invoiceNumber={e.invoiceNumber} user={user} billing={modules.has('billing')} />
          </Panel>
          {e.programme === 'course_only' && (can(user, 'course.enroll') || can(user, 'course.manage')) && (
            <Panel title="Study abroad next?" subtitle="On this course only. If they now want to study abroad, pass them to a consultant.">
              <HandOverForm
                clientId={e.clientId}
                consultants={can(user, 'client.assign') && can(user, 'staff.view') ? await apiFetch<{ id: string; name: string }[]>('/consultants').catch(() => null) : null}
                currentConsultantId={null}
                applicationHref={`${clientsBase(user)}/${e.clientId}/applications/new`}
              />
            </Panel>
          )}
          {(can(user, 'course.enroll') || can(user, 'course.manage')) && (
            <Panel title="Change">
              <EnrollmentActions e={e} batches={batches} canManage={can(user, 'course.manage')} />
              {e.status === 'frozen' && <p className="mt-2 text-[12.5px] text-ink-500">Paused {formatDate(e.frozenFrom)} to {formatDate(e.frozenUntil)}: {e.freezeReason}</p>}
              {e.status === 'dropped' && <p className="mt-2 text-[12.5px] text-ink-500">Dropped: {e.dropReason}</p>}
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

/** Where the fees stand, with a link to the invoice for those who can open it. */
export function FeeSummary({ fee, invoiceId, invoiceNumber, user, billing }: { fee: EnrollmentFee; invoiceId: string | null; invoiceNumber: string | null; user: AuthUser; billing: boolean }) {
  const invoiceHref = invoiceId ? (user.role === 'manager' ? `/overview/finance/invoices/${invoiceId}` : `/desk/invoices/${invoiceId}`) : null;
  return (
    <div className="space-y-1.5 text-[13px]">
      <Pill tone={FEE_STATUS_TONE[fee.status]}>{FEE_STATUS_LABEL[fee.status]}</Pill>
      {fee.status !== 'not_billed' && fee.currency && (
        <p className="tnum text-ink-700">
          {formatMoney(fee.paid, fee.currency)} paid of {formatMoney(fee.total, fee.currency)}
          {fee.balance > 0 && fee.status !== 'void' ? <span className="block text-ink-500">{formatMoney(fee.balance, fee.currency)} still to pay{fee.dueDate ? `, due ${formatDate(fee.dueDate)}` : ''}</span> : null}
        </p>
      )}
      {billing && invoiceHref && invoiceNumber && (can(user, 'billing.view') || can(user, 'billing.invoice')) ? (
        <Link href={invoiceHref} className="font-medium text-brand-700 hover:underline">
          Open {invoiceNumber}
        </Link>
      ) : invoiceNumber ? (
        <p className="text-ink-500">Invoice {invoiceNumber}</p>
      ) : (
        <p className="text-ink-500">Not billed on an invoice from Courses.</p>
      )}
    </div>
  );
}

/** Scores over time as a line, with the target as a dashed line. Drawn on the server. */
export function ScoreChart({ points, max, target }: { points: { label: string; value: number | null }[]; max: number; target: number | null }) {
  const w = 560;
  const h = 160;
  const pad = 28;
  const valid = points.filter((p) => p.value !== null) as { label: string; value: number }[];
  if (valid.length === 0) return null;
  const lo = Math.max(0, Math.floor(Math.min(...valid.map((p) => p.value), target ?? Infinity) - 1));
  const hi = Math.min(max, Math.ceil(Math.max(...valid.map((p) => p.value), target ?? 0) + 0.5));
  const x = (i: number) => pad + (valid.length === 1 ? (w - 2 * pad) / 2 : (i * (w - 2 * pad)) / (valid.length - 1));
  const y = (v: number) => h - pad - ((v - lo) / Math.max(0.5, hi - lo)) * (h - 2 * pad);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-40 w-full" role="img" aria-label="Mock test scores over time">
      {target !== null && target >= lo && target <= hi && (
        <>
          <line x1={pad} x2={w - pad} y1={y(target)} y2={y(target)} stroke="currentColor" className="text-ok-500" strokeDasharray="4 4" strokeWidth="1.5" />
          <text x={pad} y={y(target) - 4} textAnchor="start" className="fill-ok-600 text-[10px]">
            target {target}
          </text>
        </>
      )}
      <polyline fill="none" stroke="currentColor" className="text-brand-600" strokeWidth="2.5" points={valid.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} />
      {valid.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r="4" className="fill-brand-600" />
          <text x={x(i)} y={y(p.value) - 9} textAnchor="middle" className="fill-ink-900 text-[11px] font-semibold">
            {p.value}
          </text>
          <text x={x(i)} y={h - 8} textAnchor={valid.length > 1 && i === 0 ? 'start' : valid.length > 1 && i === valid.length - 1 ? 'end' : 'middle'} className="fill-ink-500 text-[10px]">
            {p.label.length > 14 ? `${p.label.slice(0, 13)}…` : p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Official results, report, settings                                   */
/* ------------------------------------------------------------------ */

export async function ResultsPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!can(user, 'course.view')) return <NoAccess title="Test results" permission="course.view" />;
  const expiring = query.expiring === '1';
  const [list, clients] = await Promise.all([
    apiFetch<TestResultView[]>(`/courses/results${qs({ status: query.status, expiring: expiring ? 'true' : undefined })}`),
    apiFetch<Paginated<{ id: string; fullName: string }>>('/clients?pageSize=100'),
  ]);
  const base = coursesBase(user);
  return (
    <>
      <PageHeader title="Official test results" subtitle="Bookings and results for IELTS, PTE, TOEFL and the rest - when they expire, and whether they meet what students' destinations ask for." />
      <Tabs user={user} active="results" />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {[
          ['', 'All'],
          ['booked', 'Booked'],
          ['result', 'Results'],
        ].map(([s, label]) => (
          <Link key={s} href={`${base}/results${qs({ status: s || undefined })}`} className={cx('rounded-full px-3 py-1 text-[12.5px] font-medium', (query.status ?? '') === s && !expiring ? 'bg-ink-900 text-paper' : 'bg-ink-100 text-ink-600 hover:bg-ink-200')}>
            {label}
          </Link>
        ))}
        <Link href={`${base}/results?expiring=1`} className={cx('rounded-full px-3 py-1 text-[12.5px] font-medium', expiring ? 'bg-ink-900 text-paper' : 'bg-ink-100 text-ink-600 hover:bg-ink-200')}>
          Expiring in 90 days
        </Link>
        {(can(user, 'course.manage') || can(user, 'course.enroll')) && (
          <span className="ml-auto">
            <TestResultForm clients={clients.items.map((c) => ({ id: c.id, name: c.fullName }))} clientId={null} initial={null} />
          </span>
        )}
      </div>
      <ResultsList results={list} user={user} />
    </>
  );
}

export function ResultsList({ results, user }: { results: TestResultView[]; user: AuthUser | null }) {
  if (!results.length) return <Card><EmptyState title="No test results" description="Record a booking when a student books their test, and the result when it arrives." /></Card>;
  return (
    <div className="space-y-3">
      {results.map((r) => (
        <Card key={r.id} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14.5px] font-medium text-ink-950">
                {user && opensClients(user) ? (
                  <Link href={`${clientsBase(user)}/${r.clientId}`} className="hover:text-brand-700">
                    {r.clientName}
                  </Link>
                ) : user ? (
                  r.clientName
                ) : (
                  TEST_TYPE_LABEL[r.testType]
                )}
                {user && <span className="font-normal text-ink-500"> · {TEST_TYPE_LABEL[r.testType]}</span>}
              </p>
              <p className="text-[12.5px] text-ink-500">
                {TEST_RESULT_STATUS_LABEL[r.status]} · {formatDate(r.testDate)}
                {r.venue ? ` · ${r.venue}` : ''}
                {r.reference ? ` · ${r.reference}` : ''}
                {r.expiresOn ? ` · valid until ${formatDate(r.expiresOn)}` : ''}
              </p>
              {r.status === 'result' && (
                <p className="mt-1 text-[13px] text-ink-800">
                  {Object.values(r.scores).some((v) => v !== null) && TEST_SCALES[r.testType].modules.map((m) => `${m.label} ${r.scores[m.key] ?? '–'}`).join(' · ')}
                  {r.overall !== null && <span className="ml-2 font-semibold">Overall {r.overall}</span>}
                </p>
              )}
              {r.eligibility.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.eligibility.map((e, i) => (
                    <Pill key={i} tone={e.meets ? 'ok' : 'bad'}>
                      {e.country}: {e.meets ? `meets ${e.requirement}` : e.shortBy}
                    </Pill>
                  ))}
                </div>
              )}
            </div>
            <span className="flex flex-col items-end gap-2">
              {r.expired && <Pill tone="bad">Expired</Pill>}
              {user && (can(user, 'course.manage') || can(user, 'course.enroll')) && <TestResultForm clients={[]} clientId={r.clientId} initial={r} />}
            </span>
          </div>
        </Card>
      ))}
    </div>
  );
}

export async function CourseReportPage({ user }: { user: AuthUser }) {
  if (!can(user, 'course.view')) return <NoAccess title="Courses" permission="course.view" />;
  const rows = await apiFetch<CourseReportRow[]>('/courses/reports');
  return (
    <>
      <PageHeader title="Course report" subtitle="How each course is going: who enrols and finishes, attendance, how much mock scores improve, results against targets, and what it brings in." />
      <Tabs user={user} active="report" />
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState title="No courses yet" description="Add a course to see it here." />
        ) : (
          <MoneyTable head={['Course', { label: 'Batches', right: true }, { label: 'Enrolled', right: true }, { label: 'Completed', right: true }, { label: 'Dropped', right: true }, { label: 'Attendance', right: true }, { label: 'Mock gain', right: true }, { label: 'Reached target', right: true }, { label: 'Billed', right: true }]}>
            {rows.map((r) => (
              <tr key={r.courseId} className="border-t border-line">
                <td className="px-4 py-2.5 font-medium text-ink-900">{r.courseName}</td>
                <td className="tnum px-4 py-2.5 text-right">{r.batches}</td>
                <td className="tnum px-4 py-2.5 text-right">{r.enrolled}</td>
                <td className="tnum px-4 py-2.5 text-right">{r.completed}</td>
                <td className="tnum px-4 py-2.5 text-right">{r.dropped}</td>
                <td className="tnum px-4 py-2.5 text-right">{r.attendancePercent === null ? '–' : `${r.attendancePercent}%`}</td>
                <td className="tnum px-4 py-2.5 text-right">{r.averageImprovement === null ? '–' : `${r.averageImprovement > 0 ? '+' : ''}${r.averageImprovement}`}</td>
                <td className="tnum px-4 py-2.5 text-right">{r.withResult ? `${r.reachedTarget} of ${r.withResult}` : '–'}</td>
                <td className="tnum px-4 py-2.5 text-right">{r.revenue.length ? r.revenue.map((x) => formatMoney(x.amount, x.currency)).join(' + ') : '–'}</td>
              </tr>
            ))}
          </MoneyTable>
        )}
      </Card>
    </>
  );
}

export async function CourseSettingsPage({ user }: { user: AuthUser }) {
  if (!can(user, 'course.manage')) return <NoAccess title="Course settings" permission="course.manage" />;
  const s = await apiFetch<CourseSettingsView>('/courses/settings');
  return (
    <>
      <PageHeader title="Course settings" />
      <Tabs user={user} active="settings" />
      <Card className="p-5">
        <CourseSettingsForm settings={s} />
      </Card>
    </>
  );
}

/** On the student's page: their courses and tests. */
export async function StudentCoursesCard({ user, clientId }: { user: AuthUser; clientId: string }) {
  if (!can(user, 'course.view')) return null;
  const data = await apiFetch<{ enrollments: EnrollmentView[]; results: TestResultView[] }>(`/courses/clients/${clientId}`).catch(() => null);
  if (!data) return null;
  const base = coursesBase(user);
  const live = data.enrollments.filter((e) => e.status !== 'transferred');
  const latest = data.results.find((r) => r.status === 'result');
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-[15.5px] font-medium text-ink-950">Courses and tests</h2>
        {(can(user, 'course.enroll') || can(user, 'course.manage')) && (
          <Link href={`${base}/enrol?clientId=${clientId}`} className="text-[12.5px] font-medium text-brand-700 hover:underline">
            Enrol
          </Link>
        )}
      </div>
      {live.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-ink-400">Not on a course.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {live.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 text-[13px]">
              <Link href={`${base}/enrollments/${e.id}`} className="min-w-0 truncate text-ink-800 hover:text-brand-700">
                {e.courseName} · {e.batchCode}
              </Link>
              <Pill tone={ENROLLMENT_STATUS_TONE[e.status]}>{e.status === 'waitlisted' ? `Waiting #${e.waitlistPosition}` : ENROLLMENT_STATUS_LABEL[e.status]}</Pill>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 border-t border-line pt-3 text-[12.5px]">
        {latest ? (
          <p className="text-ink-800">
            {TEST_TYPE_LABEL[latest.testType]}: <span className="font-semibold">{latest.overall ?? '–'}</span>
            <span className="text-ink-400"> · {formatDate(latest.testDate)}{latest.expired ? ' · expired' : latest.expiresOn ? ` · valid to ${formatDate(latest.expiresOn)}` : ''}</span>
            {latest.eligibility.map((e, i) => (
              <span key={i} className={cx('block', e.meets ? 'text-ok-700' : 'text-bad-700')}>
                {e.country}: {e.meets ? 'meets the requirement' : e.shortBy}
              </span>
            ))}
          </p>
        ) : (
          <p className="text-ink-400">No official test result.</p>
        )}
        {(can(user, 'course.manage') || can(user, 'course.enroll')) && (
          <div className="mt-2">
            <TestResultForm clients={[]} clientId={clientId} initial={null} />
          </div>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* The student's portal page                                            */
/* ------------------------------------------------------------------ */

export async function MyCoursesPage() {
  const data = await apiFetch<MyCoursesView>('/my-courses');
  return (
    <>
      <PageHeader title="Courses and tests" subtitle="Your classes, homework and scores, and your official test results." />
      {data.enrollments.length === 0 && data.results.length === 0 && (
        <Card>
          <EmptyState title="Nothing here yet" description="When your consultant enrols you on a course - IELTS preparation, say - it shows here." />
        </Card>
      )}
      <div className="space-y-5">
        {data.enrollments.map((e) => (
          <Panel
            key={e.id}
            title={e.courseName}
            subtitle={
              <span className="inline-flex flex-wrap items-center gap-2">
                <Pill tone={ENROLLMENT_STATUS_TONE[e.status]}>{e.status === 'waitlisted' ? `On the waiting list (#${e.waitlistPosition})` : ENROLLMENT_STATUS_LABEL[e.status]}</Pill>
                <span>
                  {e.batchCode} · {formatDate(e.batch.startDate)} to {formatDate(e.batch.endDate)} · {schedule(e.batch)} · {e.batch.location ?? 'Online'}
                  {e.batch.trainers.length ? ` · with ${e.batch.trainers.map((t) => t.name).join(', ')}` : ''}
                </span>
              </span>
            }
            action={
              e.certificateNumber ? (
                <a href={`/api/my-courses/enrollments/${e.id}/certificate`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-paper px-3 text-[12.5px] font-medium text-ink-700 hover:bg-ink-50">
                  <IconPrinter size={14} />
                  Certificate
                </a>
              ) : undefined
            }
          >
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-4">
                {e.batch.onlineLink && e.status !== 'waitlisted' && (
                  <a href={e.batch.onlineLink} target="_blank" rel="noreferrer" className="block text-[13px] font-medium text-brand-700 hover:underline">
                    Join the online class →
                  </a>
                )}
                <div>
                  <p className="mb-1 text-[13px] font-medium text-ink-900">Next classes</p>
                  {e.upcoming.length === 0 ? (
                    <p className="text-[12.5px] text-ink-400">None scheduled.</p>
                  ) : (
                    <ul className="space-y-1 text-[12.5px] text-ink-700">
                      {e.upcoming.map((s) => (
                        <li key={s.date + s.startTime}>
                          {formatDate(s.date)} · {s.startTime}-{s.endTime}
                          {s.topic ? ` · ${s.topic}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <p className="text-[12.5px] text-ink-600">
                  Attendance: <span className="font-semibold">{e.attendance.percent === null ? '–' : `${e.attendance.percent}%`}</span> ({e.attendance.present + e.attendance.late} of {e.attendance.present + e.attendance.late + e.attendance.absent} classes)
                </p>
                {e.mocks.length > 0 && (
                  <div>
                    <p className="mb-1 text-[13px] font-medium text-ink-900">Your mock test scores</p>
                    <ScoreChart points={e.mocks.map((m) => ({ label: m.title, value: m.overall }))} max={TEST_SCALES[e.testType].overall === 'sum' ? TEST_SCALES[e.testType].max * 4 : TEST_SCALES[e.testType].max} target={e.targetScore} />
                    {e.mocks.at(-1)?.feedback && <p className="text-[12.5px] text-ink-600">Latest feedback: {e.mocks.at(-1)!.feedback}</p>}
                  </div>
                )}
              </div>
              <div>
                <p className="mb-1 text-[13px] font-medium text-ink-900">Homework and materials</p>
                {e.homework.length === 0 ? (
                  <p className="text-[12.5px] text-ink-400">Nothing yet.</p>
                ) : (
                  <div className="divide-y divide-line">
                    {e.homework.map((h) => (
                      <div key={h.id} className="py-2.5 text-[13px]">
                        <p className="font-medium text-ink-900">
                          {h.title}
                          <span className="font-normal text-ink-400">{h.kind === 'material' ? ' · material' : h.dueAt ? ` · due ${formatDate(h.dueAt)}` : ''}</span>
                        </p>
                        {h.instructions && <p className="whitespace-pre-line text-ink-600">{h.instructions}</p>}
                        {h.fileName && (
                          <a href={`/api/my-courses/homework/${h.id}/file`} className="text-[12.5px] text-brand-700 hover:underline">
                            {h.fileName}
                          </a>
                        )}
                        {h.kind === 'homework' &&
                          (h.mine ? (
                            <div className="mt-1 text-[12.5px]">
                              <Pill tone={h.mine.status === 'graded' ? 'ok' : h.mine.status === 'returned' ? 'warn' : 'info'}>
                                {h.mine.status === 'graded' ? `Marked${h.mine.score !== null ? `: ${h.mine.score}${h.maxScore ? `/${h.maxScore}` : ''}` : ''}` : h.mine.status === 'returned' ? 'Sent back to you' : 'Handed in'}
                              </Pill>
                              {h.mine.feedback && <p className="mt-1 text-ink-600">{h.mine.feedback}</p>}
                              {h.mine.status === 'returned' && <SubmitHomework homeworkId={h.id} again />}
                            </div>
                          ) : (
                            e.status !== 'waitlisted' && <SubmitHomework homeworkId={h.id} again={false} />
                          ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Panel>
        ))}
        {data.results.length > 0 && (
          <Panel title="Your official test results">
            <ResultsList results={data.results} user={null} />
          </Panel>
        )}
      </div>
    </>
  );
}
