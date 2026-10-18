import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  localIsoDate,
  ENQUIRY_SOURCE_LABEL,
  ENQUIRY_STATUS_LABEL,
  ENQUIRY_STATUS_TONE,
  ENQUIRY_STATUSES,
  ENROLLMENT_STATUS_LABEL,
  ENROLLMENT_STATUS_TONE,
  FEE_STATUS_LABEL,
  FEE_STATUS_TONE,
  OPEN_ENQUIRY,
  OWING,
  STUDENT_LIST_STATUS_LABEL,
  STUDENT_LIST_STATUSES,
  TRIAL_OUTCOME_LABEL,
  formatMoney,
  type AuthUser,
  type BatchSummaryView,
  type CourseView,
  type EnquiryDetail,
  type EnquirySummary,
  type EnquiryView,
  type StudentListView,
  type TrialSlotView,
} from '@crm/shared';
import { ApiError, apiFetch, qs } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { Card, EmptyState, LinkButton, PageHeader, Panel, Pill, cx } from '../ui';
import { NoAccess } from '../no-access';
import { IconPlus } from '../icons';
import { MoneyTable } from '../finance/workspace';
import { Tabs, coursePackages, coursesBase } from './course-pages';
import { ContactForm, ConvertForm, EnquiryForm, LostForm, ReopenButton, TrialBooker, TrialOutcomeButtons } from './enquiry-forms';

const clientsBase = (user: AuthUser) => (user.role === 'manager' ? '/overview/clients' : '/desk/clients');
/** Only people who can open any client get a link to one; a trainer would land on "not found". */
const opensClients = (user: AuthUser) => user.role === 'manager' || can(user, 'client.view_all');
const seesEnquiries = (user: AuthUser) => can(user, 'course.view') || can(user, 'course.enroll') || can(user, 'course.manage');
const worksEnquiries = (user: AuthUser) => can(user, 'course.enroll') || can(user, 'course.manage');
const today = () => localIsoDate();

async function load<T>(path: string): Promise<T> {
  try {
    return await apiFetch<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
}

const chip = (on: boolean) => cx('rounded-full px-3 py-1 text-[12.5px] font-medium', on ? 'bg-ink-900 text-paper' : 'bg-ink-100 text-ink-600 hover:bg-ink-200');
const selectClass = 'h-9 rounded-lg border border-line-strong bg-paper px-2.5 text-[13px] text-ink-800';

/* ------------------------------------------------------------------ */
/* Enquiries                                                            */
/* ------------------------------------------------------------------ */

export async function EnquiriesPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!seesEnquiries(user)) return <NoAccess title="Course enquiries" permission="course.enroll" />;
  const base = coursesBase(user);
  const status = query.status && ['open', 'all', ...ENQUIRY_STATUSES].includes(query.status) ? query.status : 'open';
  const filters = { status, due: query.due === '1' ? '1' : undefined, mine: query.mine === '1' ? '1' : undefined, courseId: query.courseId, q: query.q };
  const [list, summary, courses] = await Promise.all([
    apiFetch<EnquiryView[]>(`/courses/enquiries${qs(filters)}`),
    apiFetch<EnquirySummary>('/courses/enquiries/summary'),
    apiFetch<CourseView[]>('/courses').catch(() => [] as CourseView[]),
  ]);
  const link = (patch: Record<string, string | undefined>) => `${base}/enquiries${qs({ ...filters, ...patch })}`;
  return (
    <>
      <PageHeader
        title="Course enquiries"
        subtitle="People interested in a course who have not enrolled yet: follow them up, book a trial class, enrol them or close it with the reason."
        actions={
          worksEnquiries(user) ? (
            <LinkButton href={`${base}/enquiries/new`}>
              <IconPlus size={16} />
              New enquiry
            </LinkButton>
          ) : undefined
        }
      />
      <Tabs user={user} active="enquiries" />
      <Card className="mb-5 grid grid-cols-2 gap-y-3 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
        <Figure label="New" value={summary.open.new} href={link({ status: 'new', due: undefined })} />
        <Figure label="Contacted" value={summary.open.contacted} href={link({ status: 'contacted', due: undefined })} />
        <Figure label="Trial booked" value={summary.open.trial_booked} href={link({ status: 'trial_booked', due: undefined })} />
        <Figure label="Trial done" value={summary.open.trial_done} href={link({ status: 'trial_done', due: undefined })} />
        <Figure label="Follow-ups due" value={summary.followUpsDue} tone={summary.followUpsDue ? 'warn' : undefined} href={link({ status: 'open', due: '1' })} />
        <Figure
          label="Enrolled, last 90 days"
          value={summary.last90.conversionPercent === null ? '–' : `${summary.last90.conversionPercent}%`}
          hint={`${summary.last90.enrolled} enrolled, ${summary.last90.lost} not joining, of ${summary.last90.received}`}
        />
      </Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(['open', 'new', 'contacted', 'trial_booked', 'trial_done', 'enrolled', 'lost', 'all'] as const).map((s) => (
          <Link key={s} href={link({ status: s })} className={chip(status === s)}>
            {s === 'open' ? 'Open' : s === 'all' ? 'All' : ENQUIRY_STATUS_LABEL[s]}
          </Link>
        ))}
        <Link href={link({ due: filters.due ? undefined : '1' })} className={cx(chip(Boolean(filters.due)), 'ml-auto')}>
          Follow-ups due
        </Link>
        <Link href={link({ mine: filters.mine ? undefined : '1' })} className={chip(Boolean(filters.mine))}>
          Mine
        </Link>
      </div>
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <input type="hidden" name="status" value={status} />
        {filters.due && <input type="hidden" name="due" value="1" />}
        {filters.mine && <input type="hidden" name="mine" value="1" />}
        <input name="q" defaultValue={query.q ?? ''} placeholder="Name, phone, email or ENQ number" aria-label="Search enquiries" className={cx(selectClass, 'w-64')} />
        <select name="courseId" defaultValue={query.courseId ?? ''} aria-label="Course" className={selectClass}>
          <option value="">Every course</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="h-9 rounded-lg bg-ink-900 px-3 text-[13px] font-medium text-paper">Filter</button>
      </form>
      <Card className="overflow-hidden">
        {list.length === 0 ? (
          <EmptyState title="No enquiries here" description={status === 'open' ? 'Take one when someone walks in, calls or messages - or share the website form.' : 'Nothing matches.'} />
        ) : (
          <MoneyTable head={['Enquiry', 'Course', 'From', 'Status', 'Follow up', 'With']}>
            {list.map((e) => (
              <tr key={e.id} className="border-t border-line hover:bg-ink-50/60">
                <td className="px-4 py-2.5">
                  <Link href={`${base}/enquiries/${e.id}`} className="font-medium text-ink-950 hover:text-brand-700">
                    {e.fullName}
                  </Link>
                  <span className="block text-[11.5px] text-ink-400">
                    {e.number} · {e.phone}
                    {e.studyAbroad ? ' · also study abroad' : ''}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-ink-600">
                  {e.course?.name ?? 'Not sure yet'}
                  {e.batch && <span className="block text-[11.5px] text-ink-400">{e.batch.code}</span>}
                </td>
                <td className="px-4 py-2.5 text-ink-600">
                  {ENQUIRY_SOURCE_LABEL[e.source]}
                  <span className="block text-[11.5px] text-ink-400">{formatDate(e.createdAt)}</span>
                </td>
                <td className="px-4 py-2.5">
                  <Pill tone={ENQUIRY_STATUS_TONE[e.status]}>{ENQUIRY_STATUS_LABEL[e.status]}</Pill>
                  {e.trial && <span className="block text-[11.5px] text-ink-400">Trial {formatDate(e.trial.date)}{e.trial.outcome ? `: ${TRIAL_OUTCOME_LABEL[e.trial.outcome].toLowerCase()}` : ''}</span>}
                  {e.status === 'lost' && e.lostReason && <span className="block text-[11.5px] text-ink-400">{e.lostReason}</span>}
                </td>
                <td className={cx('px-4 py-2.5', e.followUpDue ? 'font-medium text-warn-700' : 'text-ink-600')}>
                  {e.followUpOn ? (e.followUpOn === today() ? 'Today' : formatDate(e.followUpOn)) : '–'}
                  {e.followUpDue && e.followUpOn && e.followUpOn < today() ? <span className="block text-[11.5px]">overdue</span> : null}
                </td>
                <td className="px-4 py-2.5 text-ink-600">{e.assignedTo?.name ?? <span className="text-warn-700">Nobody yet</span>}</td>
              </tr>
            ))}
          </MoneyTable>
        )}
      </Card>
      {summary.bySource.length > 0 && (
        <p className="mt-3 text-[12px] text-ink-400">
          Last 90 days by source: {summary.bySource.map((s) => `${ENQUIRY_SOURCE_LABEL[s.source]} ${s.received} (${s.enrolled} enrolled)`).join(' · ')}
        </p>
      )}
    </>
  );
}

function Figure({ label, value, hint, tone, href }: { label: string; value: number | string; hint?: string; tone?: 'warn'; href?: string }) {
  const body = (
    <>
      <p className="text-[12px] text-ink-500">{label}</p>
      <p className={cx('tnum text-[20px] font-medium leading-7', tone === 'warn' ? 'text-warn-700' : 'text-ink-950')}>{value}</p>
      {hint && <p className="text-[11.5px] text-ink-400">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-lg px-2 py-1 hover:bg-ink-50">
      {body}
    </Link>
  ) : (
    <div className="px-2 py-1">{body}</div>
  );
}

async function enquiryOptions() {
  const [courses, batches, staff] = await Promise.all([
    apiFetch<CourseView[]>('/courses').catch(() => [] as CourseView[]),
    apiFetch<BatchSummaryView[]>('/courses/batches?status=current').catch(() => [] as BatchSummaryView[]),
    apiFetch<{ id: string; name: string }[]>('/courses/enquiries/staff').catch(() => []),
  ]);
  return { courses: courses.map((c) => ({ id: c.id, name: c.name })), batches: batches.filter((b) => b.status !== 'completed' && b.status !== 'cancelled'), staff };
}

export async function NewEnquiryPage({ user }: { user: AuthUser }) {
  if (!worksEnquiries(user)) return <NoAccess title="New enquiry" permission="course.enroll" />;
  const base = coursesBase(user);
  const o = await enquiryOptions();
  return (
    <>
      <PageHeader title="New enquiry" subtitle="Someone asking about a course. Only their name and phone are needed now." breadcrumb={[{ href: `${base}/enquiries`, label: 'Enquiries' }, { label: 'New' }]} />
      <Card className="max-w-3xl p-5">
        <EnquiryForm initial={null} base={base} courses={o.courses} batches={o.batches} staff={o.staff} me={user.id} />
      </Card>
    </>
  );
}

export async function EnquiryPage({ user, id }: { user: AuthUser; id: string }) {
  if (!seesEnquiries(user)) return <NoAccess title="Course enquiries" permission="course.enroll" />;
  const base = coursesBase(user);
  const e = await load<EnquiryDetail>(`/courses/enquiries/${id}`);
  const work = worksEnquiries(user);
  const open = OPEN_ENQUIRY.includes(e.status);
  const [o, slots, packages] = await Promise.all([
    enquiryOptions(),
    work && open ? apiFetch<TrialSlotView[]>('/courses/enquiries/trial-slots').catch(() => []) : Promise.resolve([] as TrialSlotView[]),
    work && open && can(user, 'billing.invoice') ? coursePackages() : Promise.resolve([]),
  ]);
  const trialHappened = e.trial ? e.trial.date <= today() : false;
  // The forms below start from the enquiry as loaded; after any change they start again from the new one.
  const version = [e.status, e.followUpOn, e.batch?.id, e.trial?.sessionId, e.trial?.outcome, e.assignedTo?.id, e.events.length].join('|');
  return (
    <>
      <PageHeader
        title={e.fullName}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Pill tone={ENQUIRY_STATUS_TONE[e.status]}>{ENQUIRY_STATUS_LABEL[e.status]}</Pill>
            <span>
              {e.number} · {e.phone}
              {e.email ? ` · ${e.email}` : ''} · {ENQUIRY_SOURCE_LABEL[e.source]}, {formatDate(e.createdAt)}
              {e.course ? ` · ${e.course.name}` : ''}
            </span>
          </span>
        }
        breadcrumb={[{ href: `${base}/enquiries`, label: 'Enquiries' }, { label: e.number }]}
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-5">
          {e.status === 'enrolled' && e.enrollment && (
            <Card className="p-4 text-[13.5px]">
              Enrolled in {e.enrollment.batchCode} as{' '}
              <Link href={`${base}/enrollments/${e.enrollment.id}`} className="font-medium text-brand-700 hover:underline">
                {e.enrollment.number}
              </Link>
              {e.client && opensClients(user) && (
                <>
                  {' '}
                  · student record{' '}
                  <Link href={`${clientsBase(user)}/${e.client.id}`} className="font-medium text-brand-700 hover:underline">
                    {e.client.name}
                  </Link>
                </>
              )}
              .
            </Card>
          )}
          {e.status === 'lost' && (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-[13.5px]">
              <span>Not joining: {e.lostReason}</span>
              {work && <ReopenButton id={e.id} />}
            </Card>
          )}
          {open && work && (
            <Panel title="Follow up" subtitle={e.followUpOn ? `Next follow-up ${e.followUpOn === today() ? 'today' : formatDate(e.followUpOn)}${e.followUpDue && e.followUpOn < today() ? ' (overdue)' : ''}` : 'No follow-up set'}>
              <ContactForm id={e.id} />
            </Panel>
          )}
          {open && work && (
            <Panel title="Trial class" subtitle="Let them sit in on a class before deciding. The trainer sees them on the attendance sheet.">
              {e.trial && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-ink-50 px-3 py-2 text-[13px]">
                  <span>
                    {formatDate(e.trial.date)} · {e.trial.startTime}-{e.trial.endTime} ·{' '}
                    <Link href={`${base}/sessions/${e.trial.sessionId}`} className="text-brand-700 hover:underline">
                      {e.trial.batchCode}
                    </Link>
                    {e.trial.outcome && <span className="ml-2 font-medium">{TRIAL_OUTCOME_LABEL[e.trial.outcome]}</span>}
                  </span>
                  {trialHappened && <TrialOutcomeButtons id={e.id} outcome={e.trial.outcome} />}
                </div>
              )}
              <TrialBooker id={e.id} slots={slots} courseId={e.course?.id ?? null} rebook={Boolean(e.trial)} />
            </Panel>
          )}
          {open && work && (
            <Panel title="Enrol" subtitle={e.client ? undefined : 'Makes their student record (course only, unless they also want to study abroad), then enrols them.'}>
              <ConvertForm key={version} enquiry={e} batches={o.batches} packages={packages} canBill={can(user, 'billing.invoice')} base={base} />
            </Panel>
          )}
          <Panel title="History">
            <ol className="space-y-3">
              {e.events.map((ev) => (
                <li key={ev.id} className="text-[13px]">
                  <p className="whitespace-pre-line text-ink-800">{ev.body}</p>
                  <p className="text-[11.5px] text-ink-400">
                    {ev.kind === 'call' ? 'Call · ' : ''}
                    {ev.byName ?? 'Website'} · {formatDate(ev.at)}
                  </p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
        <div className="space-y-5">
          {work ? (
            <Panel title="Details">
              <EnquiryForm key={version} initial={e} base={base} courses={o.courses} batches={o.batches} staff={o.staff} me={user.id} />
            </Panel>
          ) : (
            <Panel title="Details">
              <p className="text-[13px] text-ink-700">{e.notes ?? 'No notes.'}</p>
            </Panel>
          )}
          {open && work && (
            <Panel title="Not joining?">
              <LostForm id={e.id} />
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Every student                                                        */
/* ------------------------------------------------------------------ */

export async function StudentsPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!can(user, 'course.view') && !can(user, 'course.teach')) return <NoAccess title="Course students" permission="course.view" />;
  const base = coursesBase(user);
  const status = (STUDENT_LIST_STATUSES as readonly string[]).includes(query.status ?? '') ? query.status! : 'current';
  const fees = ['owing', 'overdue', 'paid', 'not_billed'].includes(query.fees ?? '') ? query.fees : undefined;
  const programme = ['course_only', 'study_abroad'].includes(query.programme ?? '') ? query.programme : undefined;
  const page = Math.max(1, Number(query.page) || 1);
  const filters = { status, fees, programme, courseId: query.courseId, batchId: query.batchId, q: query.q, handOver: query.handOver === '1' ? '1' : undefined };
  const [data, courses, batches] = await Promise.all([
    apiFetch<StudentListView>(`/courses/students${qs({ ...filters, page })}`),
    can(user, 'course.view') ? apiFetch<CourseView[]>('/courses?all=true').catch(() => [] as CourseView[]) : Promise.resolve([] as CourseView[]),
    apiFetch<BatchSummaryView[]>(`/courses/batches${qs({ status: 'all', mine: can(user, 'course.view') ? undefined : 'true' })}`).catch(() => [] as BatchSummaryView[]),
  ]);
  const link = (patch: Record<string, string | undefined>) => `${base}/students${qs({ ...filters, ...patch })}`;
  return (
    <>
      <PageHeader
        title={can(user, 'course.view') ? 'Course students' : 'My students'}
        subtitle="Everyone on a course, across batches: who is waiting, starting soon, in class or finished, how they are doing, and their fees."
        actions={
          can(user, 'course.enroll') || can(user, 'course.manage') ? (
            <LinkButton href={`${base}/enrol`}>
              <IconPlus size={16} />
              Enrol a student
            </LinkButton>
          ) : undefined
        }
      />
      <Tabs user={user} active="students" />
      <div className="mb-3 flex flex-wrap gap-2">
        {STUDENT_LIST_STATUSES.map((s) => (
          <Link key={s} href={link({ status: s, handOver: undefined })} className={chip(status === s && !filters.handOver)}>
            {STUDENT_LIST_STATUS_LABEL[s]}
          </Link>
        ))}
        <Link href={link({ status: 'completed', handOver: '1', programme: undefined })} className={cx(chip(Boolean(filters.handOver)), 'ml-auto')}>
          Finished, could study abroad
        </Link>
      </div>
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <input type="hidden" name="status" value={status} />
        {filters.handOver && <input type="hidden" name="handOver" value="1" />}
        <input name="q" defaultValue={query.q ?? ''} placeholder="Name, phone, email or ENR number" aria-label="Search students" className={cx(selectClass, 'w-60')} />
        {courses.length > 0 && (
          <select name="courseId" defaultValue={query.courseId ?? ''} aria-label="Course" className={selectClass}>
            <option value="">Every course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <select name="batchId" defaultValue={query.batchId ?? ''} aria-label="Batch" className={selectClass}>
          <option value="">Every batch</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code}
            </option>
          ))}
        </select>
        <select name="fees" defaultValue={fees ?? ''} aria-label="Fees" className={selectClass}>
          <option value="">Any fees</option>
          <option value="owing">Owing money</option>
          <option value="overdue">Overdue</option>
          <option value="paid">Paid</option>
          <option value="not_billed">Not billed</option>
        </select>
        <select name="programme" defaultValue={programme ?? ''} aria-label="Programme" className={selectClass}>
          <option value="">Course and study abroad</option>
          <option value="course_only">Course only</option>
          <option value="study_abroad">Also study abroad</option>
        </select>
        <button className="h-9 rounded-lg bg-ink-900 px-3 text-[13px] font-medium text-paper">Filter</button>
      </form>
      <p className="mb-2 text-[12.5px] text-ink-500">
        {data.total} {data.total === 1 ? 'student' : 'students'}
        {data.owing.length ? ` · ${data.owing.map((o) => formatMoney(o.amount, o.currency)).join(' + ')} still to pay` : ''}
      </p>
      <Card className="overflow-hidden">
        {data.items.length === 0 ? (
          <EmptyState title="Nobody here" description={filters.handOver ? 'No course-only student has finished a course yet.' : 'Nobody matches these filters.'} />
        ) : (
          <MoneyTable head={['Student', 'Course and batch', 'Status', 'Attendance', 'Latest mock', 'Fees']}>
            {data.items.map((e) => (
              <tr key={e.id} className="border-t border-line hover:bg-ink-50/60">
                <td className="px-4 py-2.5">
                  <Link href={`${base}/enrollments/${e.id}`} className="font-medium text-ink-950 hover:text-brand-700">
                    {e.clientName}
                  </Link>
                  <span className="block text-[11.5px] text-ink-400">
                    {e.number}
                    {e.consultantName ? ` · ${e.consultantName}` : ''}
                    {e.programme === 'course_only' ? ' · course only' : ''}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-ink-600">
                  {e.courseName}
                  <Link href={`${base}/batches/${e.batchId}`} className="block text-[11.5px] text-ink-400 hover:text-brand-700">
                    {e.batchCode}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  <Pill tone={ENROLLMENT_STATUS_TONE[e.status]}>{e.status === 'waitlisted' ? `Waiting #${e.waitlistPosition}` : ENROLLMENT_STATUS_LABEL[e.status]}</Pill>
                </td>
                <td className="tnum px-4 py-2.5">{e.attendance.percent === null ? '–' : <span className={cx(e.attendance.percent < 75 && 'text-warn-700')}>{e.attendance.percent}%</span>}</td>
                <td className="tnum px-4 py-2.5">
                  {e.latestMock ? `${e.latestMock.overall ?? '–'}` : '–'}
                  {e.targetScore ? <span className="block text-[11.5px] text-ink-400">target {e.targetScore}</span> : null}
                </td>
                <td className="px-4 py-2.5 text-[12.5px]">
                  <Pill tone={FEE_STATUS_TONE[e.fee.status]}>{FEE_STATUS_LABEL[e.fee.status]}</Pill>
                  {e.fee.currency && OWING.includes(e.fee.status) ? <span className="tnum block text-[11.5px] text-ink-500">{formatMoney(e.fee.balance, e.fee.currency)} to pay</span> : null}
                </td>
              </tr>
            ))}
          </MoneyTable>
        )}
      </Card>
      {data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-[13px] text-ink-600">
          <span>
            Page {data.page} of {data.totalPages}
          </span>
          <span className="flex gap-2">
            {data.page > 1 && (
              <Link href={link({ page: data.page > 2 ? String(data.page - 1) : undefined })} className="rounded-lg border border-line-strong px-3 py-1 hover:bg-ink-50">
                Previous
              </Link>
            )}
            {data.page < data.totalPages && (
              <Link href={link({ page: String(data.page + 1) })} className="rounded-lg border border-line-strong px-3 py-1 hover:bg-ink-50">
                Next
              </Link>
            )}
          </span>
        </div>
      )}
    </>
  );
}
