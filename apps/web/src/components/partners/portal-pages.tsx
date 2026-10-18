import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  CONFLICT_STATUS_LABEL,
  KYC_KIND_LABEL,
  KYC_REQUIRED,
  KYC_STATUS_LABEL,
  PARTNER_AGREEMENT_STATUS_LABEL,
  PARTNER_KIND_LABEL,
  PARTNER_MEMBER_ROLE_LABEL,
  PARTNER_STATUS_LABEL,
  PARTNER_STATUS_TONE,
  PARTNER_TIER_LABEL,
  formatMoney,
  type AdvanceView,
  type AttributionConflictView,
  type AuthUser,
  type Paginated,
  type PartnerAgreementView,
  type PartnerDashboard,
  type PartnerEarningView,
  type PartnerMemberView,
  type PartnerMessageView,
  type PartnerPerformanceRow,
  type PartnerStudentView,
  type PartnerView,
  type PayoutView,
} from '@crm/shared';
import { ApiError, apiFetch, qs } from '@/lib/api';
import { formatBytes, formatDate, relativeDays } from '@/lib/format';
import { Card, EmptyState, LinkButton, PageHeader, Panel, Pill, StatCard, cx } from '../ui';
import { IconAlert, IconCheck, IconPlus, IconPrinter, IconUsers, IconWallet } from '../icons';
import { Pagination } from '../client-table';
import { MoneyTable } from '../finance/workspace';
import { AddMemberForm, BankForm, KycUploadForm, MemberActions, MessageComposer } from './partner-forms';
import { RegisterStudentForm, SignAgreement, StudentDocUpload } from './portal-forms';
import { EarningsTable, MessageList, PayoutsTable } from './staff-pages';

type Me = PartnerView & { role: string; canManage: boolean };

const me = () => apiFetch<Me>('/partner-portal/me');
function money(list: { currency: string; amount: number }[]) {
  return list.length ? list.map((x) => formatMoney(x.amount, x.currency)).join(' + ') : '–';
}

function ManagersOnly({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <EmptyState title="For your organisation’s owner and administrators" description="Ask them if you need to see this." />
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The dashboard                                                        */
/* ------------------------------------------------------------------ */

export async function PartnerDashboardPage({ user }: { user: AuthUser }) {
  const d = await apiFetch<PartnerDashboard>('/partner-portal/dashboard');
  const p = d.partner;
  const firstName = user.fullName.split(' ')[0];
  const onboarding = p.status !== 'active';
  return (
    <>
      <PageHeader
        title={`Welcome, ${firstName}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Pill tone={PARTNER_STATUS_TONE[p.status]}>{PARTNER_STATUS_LABEL[p.status]}</Pill>
            <span>
              {p.name} · {PARTNER_KIND_LABEL[p.kind]} · {PARTNER_TIER_LABEL[p.tier]} partner
            </span>
          </span>
        }
        actions={
          p.status === 'active' ? (
            <LinkButton href="/partner/students/new">
              <IconPlus size={16} />
              Register a student
            </LinkButton>
          ) : undefined
        }
      />

      {onboarding && (
        <Panel title="Finish your registration" subtitle="The consultancy approves your partnership once these are done" className="mb-5">
          <ol className="space-y-2 text-[13.5px]">
            <Step done={d.kyc === 'approved'} text={`Upload your registration papers (${KYC_REQUIRED.map((k) => KYC_KIND_LABEL[k].toLowerCase()).join(', ')})`} status={KYC_STATUS_LABEL[d.kyc]} href="/partner/profile" />
            <Step done={d.agreement?.status === 'signed'} text="Sign the partner agreement" status={d.agreement ? PARTNER_AGREEMENT_STATUS_LABEL[d.agreement.status] : 'Not sent to you yet'} href="/partner/agreement" />
            <Step done={p.status === 'active'} text="Approval by the consultancy" status={PARTNER_STATUS_LABEL[p.status]} />
          </ol>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Students" value={d.counts.students} tone="info" icon={<IconUsers size={18} />} href="/partner/students" hint={`${d.counts.activeApplications} applications in progress`} />
        <StatCard label="Offers" value={d.counts.offers} tone="neutral" icon={<IconCheck size={18} />} hint={`${d.counts.visas} visas granted`} />
        <StatCard label="Enrolled this year" value={d.counts.enrolledThisYear} tone="ok" icon={<IconCheck size={18} />} hint={d.nextTier ? `${d.nextTier.enrolledLast12Months} of ${d.nextTier.needed} for ${PARTNER_TIER_LABEL[d.nextTier.tier]}` : 'Top tier'} />
        {d.me.canManage ? (
          <StatCard label="Owed to you" value={money(d.earnings.map((e) => ({ currency: e.currency, amount: e.owed + e.onPayout })))} tone="warn" icon={<IconWallet size={18} />} href="/partner/commissions" hint={`${money(d.earnings.map((e) => ({ currency: e.currency, amount: e.paidThisYear })))} paid this year`} />
        ) : (
          <StatCard label="Messages" value={d.unreadMessages} tone={d.unreadMessages ? 'warn' : 'neutral'} icon={<IconAlert size={18} />} href="/partner/messages" hint="Unread from the consultancy" />
        )}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Panel title="Latest on your students">
          {d.recent.length === 0 ? (
            <p className="text-[13px] text-ink-400">Nothing yet. Register a student to get started.</p>
          ) : (
            <ul className="space-y-2 text-[13px]">
              {d.recent.map((r, i) => (
                <li key={`${r.clientId}-${i}`} className="flex items-center justify-between gap-2">
                  <Link href={`/partner/students/${r.clientId}`} className="min-w-0 truncate text-ink-900 hover:text-brand-700">
                    <span className="font-medium">{r.clientName}</span> <span className="text-ink-500">· {r.text}</span>
                  </Link>
                  <span className="shrink-0 text-[12px] text-ink-400">{relativeDays(r.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="space-y-5">
          {d.me.canManage && d.expected.length > 0 && (
            <Panel title="Still to come" subtitle="An estimate: your share of commission universities have not paid yet">
              <p className="tnum text-[20px] font-semibold text-ink-950">{money(d.expected)}</p>
            </Panel>
          )}
          <Panel title="News from the consultancy">
            {d.announcements.length === 0 ? (
              <p className="text-[13px] text-ink-400">Nothing new.</p>
            ) : (
              <ul className="space-y-3">
                {d.announcements.map((a) => (
                  <li key={a.id}>
                    <p className="text-[13.5px] font-medium text-ink-900">
                      {a.title} {a.pinned && <Pill tone="info">Pinned</Pill>}
                    </p>
                    <p className="whitespace-pre-line text-[13px] text-ink-600">{a.body}</p>
                    <p className="text-[11.5px] text-ink-400">{formatDate(a.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function Step({ done, text, status, href }: { done: boolean; text: string; status: string; href?: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className={cx('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', done ? 'bg-ok-500 text-paper' : 'bg-ink-100 text-ink-500')}>{done ? '✓' : ''}</span>
      <span className="min-w-0">
        {href && !done ? (
          <Link href={href} className="font-medium text-brand-700 hover:underline">
            {text}
          </Link>
        ) : (
          <span className={cx(done ? 'text-ink-500 line-through' : 'text-ink-900')}>{text}</span>
        )}
        <span className="block text-[12px] text-ink-400">{status}</span>
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Students                                                             */
/* ------------------------------------------------------------------ */

export async function PartnerStudentsPage({ query }: { query: Record<string, string | undefined> }) {
  const [students, conflicts, dash] = await Promise.all([
    apiFetch<PartnerStudentView[]>(`/partner-portal/students${qs({ q: query.q })}`),
    apiFetch<AttributionConflictView[]>('/partner-portal/conflicts'),
    apiFetch<PartnerDashboard>('/partner-portal/dashboard'),
  ]);
  const open = conflicts.filter((c) => c.status === 'open');
  return (
    <>
      <PageHeader
        title="Students"
        subtitle="The students you registered, and how their applications are going."
        actions={
          dash.partner.status === 'active' ? (
            <LinkButton href="/partner/students/new">
              <IconPlus size={16} />
              Register a student
            </LinkButton>
          ) : undefined
        }
      />
      {conflicts.length > 0 && (
        <Panel title="Registrations under review" subtitle="Students the consultancy already knew; it decides who they belong to" className="mb-5">
          <ul className="space-y-1.5 text-[13px]">
            {conflicts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {c.clientName} <span className="text-ink-400">· registered {formatDate(c.createdAt)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Pill tone={c.status === 'open' ? 'warn' : c.status === 'transferred' ? 'ok' : 'neutral'}>{c.status === 'transferred' ? 'Now yours' : c.status === 'kept' ? 'Stayed with the first' : CONFLICT_STATUS_LABEL[c.status]}</Pill>
                  {c.status === 'transferred' && (
                    <Link href={`/partner/students/${c.clientId}`} className="text-brand-700 hover:underline">
                      Open
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {open.length > 0 && <p className="mt-2 text-[12px] text-ink-400">{open.length} waiting for a decision.</p>}
        </Panel>
      )}
      <form action="/partner/students" className="mb-3 flex gap-2 text-[13px]">
        <input name="q" defaultValue={query.q} placeholder="Name, email or phone" className="h-9 w-64 rounded-lg border border-line-strong bg-paper px-2.5" />
        <button className="h-9 rounded-lg bg-ink-900 px-3 font-medium text-paper">Search</button>
      </form>
      <Card className="overflow-hidden">
        {students.length === 0 ? (
          <EmptyState title="No students yet" description="Register a student and follow their application here." />
        ) : (
          <MoneyTable head={['Student', 'Applications', 'Consultant', { label: 'Documents', right: true }]}>
            {students.map((s) => (
              <tr key={s.clientId} className="border-t border-line hover:bg-ink-50/60">
                <td className="px-4 py-2.5">
                  <Link href={`/partner/students/${s.clientId}`} className="font-medium text-ink-950 hover:text-brand-700">
                    {s.fullName}
                  </Link>
                  <span className="block text-[11.5px] text-ink-400">
                    {s.email}
                    {s.viaPartnerName ? ` · via your sub-agent ${s.viaPartnerName}` : ''}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-[12.5px] text-ink-700">
                  {s.applications.length === 0
                    ? '–'
                    : s.applications.map((a) => (
                        <span key={a.id} className="block">
                          {a.university ?? a.country}
                          {a.intake ? ` · ${a.intake}` : ''} · <span className="font-medium">{a.stageLabel}</span>
                        </span>
                      ))}
                </td>
                <td className="px-4 py-2.5 text-ink-600">{s.consultantName ?? 'Being assigned'}</td>
                <td className="tnum px-4 py-2.5 text-right">{s.documents}</td>
              </tr>
            ))}
          </MoneyTable>
        )}
      </Card>
    </>
  );
}

export async function PartnerNewStudentPage() {
  return (
    <>
      <PageHeader title="Register a student" subtitle="If the consultancy already knows the student, it decides who they belong to." breadcrumb={[{ href: '/partner/students', label: 'Students' }, { label: 'New' }]} />
      <Card className="max-w-4xl p-5">
        <RegisterStudentForm />
      </Card>
    </>
  );
}

interface StudentDetail extends PartnerStudentView {
  city: string | null;
  nationality: string | null;
  intendedLevel: string | null;
  intendedField: string | null;
  englishTest: string | null;
  englishScore: string | null;
  documentList: { id: string; name: string; type: string; status: string; uploadedAt: string; byYou: boolean }[];
}

export async function PartnerStudentPage({ id }: { id: string }) {
  let s: StudentDetail;
  try {
    s = await apiFetch<StudentDetail>(`/partner-portal/students/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const mine = s.viaPartnerName === null;
  return (
    <>
      <PageHeader title={s.fullName} subtitle={`${s.email} · ${s.phone}${s.viaPartnerName ? ` · via ${s.viaPartnerName}` : ''}`} breadcrumb={[{ href: '/partner/students', label: 'Students' }, { label: s.fullName }]} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Panel title="Applications">
            {s.applications.length === 0 ? (
              <p className="text-[13px] text-ink-400">None yet. The consultancy opens them.</p>
            ) : (
              <div className="divide-y divide-line">
                {s.applications.map((a) => (
                  <div key={a.id} className="py-2.5 text-[13px]">
                    <p className="font-medium text-ink-900">
                      {a.program ?? 'Programme not chosen'} · {a.university ?? a.country}
                    </p>
                    <p className="text-ink-500">
                      {a.reference} · {a.country}
                      {a.intake ? ` · ${a.intake}` : ''} · <span className="font-medium text-ink-800">{a.stageLabel}</span> · {a.status.replace('_', ' ')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Documents" subtitle="What you upload goes to the student's consultant to check">
            {s.documentList.length === 0 ? (
              <p className="mb-3 text-[13px] text-ink-400">None yet.</p>
            ) : (
              <div className="mb-4 divide-y divide-line">
                {s.documentList.map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                    <a href={`/api/partner-portal/students/${s.clientId}/documents/${d.id}`} target="_blank" rel="noreferrer" className="text-ink-900 hover:text-brand-700">
                      {d.name}
                    </a>
                    <span className="flex items-center gap-2 text-[12px] text-ink-500">
                      {d.byYou ? 'uploaded by you · ' : ''}
                      {formatDate(d.uploadedAt)}
                      <Pill tone={d.status === 'verified' ? 'ok' : d.status === 'rejected' ? 'bad' : 'warn'}>{d.status.replace('_', ' ')}</Pill>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {mine && <StudentDocUpload clientId={s.clientId} />}
          </Panel>
        </div>
        <Panel title="Profile">
          <dl className="space-y-2 text-[13px]">
            {(
              [
                ['Consultant', s.consultantName ?? 'Being assigned'],
                ['City', s.city],
                ['Nationality', s.nationality],
                ['Level', s.intendedLevel],
                ['Subject', s.intendedField],
                ['English', s.englishTest ? `${s.englishTest} ${s.englishScore ?? ''}` : null],
                ['Registered', formatDate(s.attributedAt ?? s.createdAt)],
                ['By', s.registeredByName],
              ] as [string, string | null][]
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-ink-400">{k}</dt>
                <dd className="text-right text-ink-800">{v ?? '–'}</dd>
              </div>
            ))}
          </dl>
          <Link href={`/partner/messages`} className="mt-4 block text-[12.5px] font-medium text-brand-700 hover:underline">
            Message the consultancy about this student →
          </Link>
        </Panel>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Money                                                                */
/* ------------------------------------------------------------------ */

export async function PartnerCommissionsPage({ query }: { query: Record<string, string | undefined> }) {
  const m = await me();
  if (!m.canManage) return <ManagersOnly title="Commissions" />;
  const pageNo = Math.max(1, Number(query.page) || 1);
  const [list, dash] = await Promise.all([
    apiFetch<Paginated<PartnerEarningView>>(`/partner-portal/earnings${qs({ status: query.status, page: pageNo })}`),
    apiFetch<PartnerDashboard>('/partner-portal/dashboard'),
  ]);
  return (
    <>
      <PageHeader title="Commissions" subtitle="What you have earned, as each amount falls due - and anything taken back." />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Owed to you" value={money(dash.earnings.map((e) => ({ currency: e.currency, amount: e.owed })))} tone="warn" icon={<IconWallet size={18} />} hint="Not on a payout yet" />
        <StatCard label="On a payout" value={money(dash.earnings.map((e) => ({ currency: e.currency, amount: e.onPayout })))} tone="info" icon={<IconWallet size={18} />} hint="Being paid" />
        <StatCard label="Paid this year" value={money(dash.earnings.map((e) => ({ currency: e.currency, amount: e.paidThisYear })))} tone="ok" icon={<IconCheck size={18} />} href="/partner/payouts" />
      </div>
      <Card className="overflow-hidden">
        <EarningsTable earnings={list.items} clientsHref="/partner/students" payoutsHref={null} />
      </Card>
      <Pagination data={list} buildHref={(n) => `/partner/commissions${qs({ status: query.status, page: n })}`} />
    </>
  );
}

export async function PartnerPayoutsPage() {
  const m = await me();
  if (!m.canManage) return <ManagersOnly title="Payouts" />;
  const [payouts, advances] = await Promise.all([apiFetch<PayoutView[]>('/partner-portal/payouts'), apiFetch<AdvanceView[]>('/partner-portal/advances')]);
  return (
    <>
      <PageHeader title="Payouts" subtitle="Money paid to you, with tax withheld and any advance taken back. Each has a statement." />
      {payouts.length === 0 ? (
        <Card>
          <EmptyState title="No payouts yet" description="When the consultancy pays what you are owed, it shows here with its statement." />
        </Card>
      ) : (
        <div className="space-y-3">
          {payouts.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[14.5px] font-medium text-ink-950">
                    {p.number} · {formatMoney(p.net, p.currency)}
                  </p>
                  <p className="text-[12.5px] text-ink-500">
                    {p.periodLabel} · {p.status === 'paid' ? `paid ${formatDate(p.paidOn)}${p.reference ? `, ref ${p.reference}` : ''}` : 'approved, being paid'} · earned {formatMoney(p.gross, p.currency)}
                    {p.withholding ? `, ${formatMoney(p.withholding, p.currency)} tax withheld` : ''}
                    {p.advanceRecovered ? `, ${formatMoney(p.advanceRecovered, p.currency)} advance taken back` : ''}
                  </p>
                </div>
                <a href={`/api/partner-portal/payouts/${p.id}/statement`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-paper px-3 text-[12.5px] font-medium text-ink-700 hover:bg-ink-50">
                  <IconPrinter size={14} />
                  Statement
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}
      {advances.length > 0 && (
        <Panel title="Advances" subtitle="Paid to you ahead of earnings; taken back from payouts" className="mt-5">
          <ul className="space-y-1.5 text-[13px]">
            {advances
              .filter((a) => !a.voided)
              .map((a) => (
                <li key={a.id} className="flex justify-between gap-2">
                  <span>
                    {a.number} · {formatDate(a.givenOn)} · {a.reason}
                  </span>
                  <span className="tnum">
                    {formatMoney(a.amount, a.currency)} <span className="text-ink-400">· {formatMoney(a.outstanding, a.currency)} still to take back</span>
                  </span>
                </li>
              ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Resources, messages, agreement, team, profile                         */
/* ------------------------------------------------------------------ */

export async function PartnerResourcesPage() {
  const lib = await apiFetch<{ folders: { id: string; name: string; files: { id: string; name: string; size: number; mime: string; uploadedAt: string }[] }[] }>('/partner-portal/resources');
  return (
    <>
      <PageHeader title="Resources" subtitle="Brochures, price lists and guides the consultancy shares with its partners." />
      {lib.folders.length === 0 ? (
        <Card>
          <EmptyState title="Nothing shared yet" description="The consultancy has not shared any material with partners yet." />
        </Card>
      ) : (
        <div className="space-y-5">
          {lib.folders.map((f) => (
            <Panel key={f.id} title={f.name} bodyClassName="">
              {f.files.length === 0 ? (
                <p className="px-5 pb-5 text-[13px] text-ink-400">Empty.</p>
              ) : (
                <div className="divide-y divide-line">
                  {f.files.map((x) => (
                    <a key={x.id} href={`/api/partner-portal/resources/${x.id}`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-[13px] hover:bg-ink-50">
                      <span className="text-ink-900">{x.name}</span>
                      <span className="text-[12px] text-ink-400">
                        {formatBytes(x.size)} · {formatDate(x.uploadedAt)}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}

export async function PartnerMessagesPage() {
  const [messages, students] = await Promise.all([apiFetch<PartnerMessageView[]>('/partner-portal/messages'), apiFetch<PartnerStudentView[]>('/partner-portal/students')]);
  return (
    <>
      <PageHeader title="Messages" subtitle="Your conversation with the consultancy." />
      <Card className="p-5">
        <MessageList messages={messages} mineIsPartner />
        <div className="mt-4">
          <MessageComposer url="/api/partner-portal/messages" students={students.map((s) => ({ id: s.clientId, name: s.fullName }))} />
        </div>
      </Card>
    </>
  );
}

export async function PartnerAgreementPage({ user }: { user: AuthUser }) {
  const [list, m] = await Promise.all([apiFetch<PartnerAgreementView[]>('/partner-portal/agreements'), me()]);
  const waiting = list.find((a) => a.status === 'sent');
  return (
    <>
      <PageHeader title="Partner agreement" subtitle="The terms of your partnership, signed here." />
      {list.length === 0 && (
        <Card>
          <EmptyState title="Not sent to you yet" description="The consultancy will send the agreement for you to sign once your papers are in." />
        </Card>
      )}
      <div className="space-y-5">
        {list.map((a) => (
          <Panel
            key={a.id}
            title={`${a.title} (version ${a.version})`}
            subtitle={`${PARTNER_AGREEMENT_STATUS_LABEL[a.status]}${a.signedAt ? ` · signed ${formatDate(a.signedAt)} by ${a.signerName}` : ''}`}
            action={
              a.status !== 'sent' ? (
                <a href={`/api/partner-portal/agreements/${a.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-paper px-3 text-[12.5px] font-medium text-ink-700 hover:bg-ink-50">
                  <IconPrinter size={14} />
                  {a.status === 'signed' ? 'Signed copy' : 'PDF'}
                </a>
              ) : undefined
            }
          >
            <div className="mb-4 max-h-[420px] overflow-y-auto whitespace-pre-line rounded-lg border border-line p-4 text-[13px] leading-relaxed text-ink-800">{a.body}</div>
            {a.id === waiting?.id &&
              (m.canManage ? (
                <SignAgreement agreementId={a.id} defaultName={user.fullName} />
              ) : (
                <p className="text-[13px] text-ink-500">Your organisation’s owner or an administrator signs it.</p>
              ))}
          </Panel>
        ))}
      </div>
    </>
  );
}

export async function PartnerTeamPage() {
  const [team, m, subs] = await Promise.all([
    apiFetch<PartnerMemberView[]>('/partner-portal/team'),
    me(),
    apiFetch<PartnerPerformanceRow[]>('/partner-portal/sub-agents').catch(() => []),
  ]);
  const roles = m.canManage ? (['admin', 'counsellor'] as const) : [];
  return (
    <>
      <PageHeader title="Team" subtitle="The people in your organisation who sign in here." />
      <Panel title="Logins" action={m.canManage && m.status !== 'terminated' ? <AddMemberForm url="/api/partner-portal/team" roles={[...roles]} /> : undefined}>
        <div className="divide-y divide-line">
          {team.map((x) => (
            <div key={x.id} className={cx('flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13px]', !x.active && 'opacity-60')}>
              <span>
                <span className="font-medium text-ink-900">{x.fullName}</span>
                <span className="text-ink-500">
                  {' '}
                  · {x.email} · {PARTNER_MEMBER_ROLE_LABEL[x.role]}
                  {x.lastSeenAt ? ` · last signed in ${relativeDays(x.lastSeenAt)}` : ''}
                </span>
              </span>
              {m.canManage && x.role !== 'owner' && <MemberActions url={`/api/partner-portal/team/${x.id}`} member={x} roles={[...roles]} />}
            </div>
          ))}
        </div>
      </Panel>
      {subs.length > 0 && (
        <Panel title="Your sub-agents" subtitle="Last 12 months. You earn an override on their students." className="mt-5" bodyClassName="">
          <MoneyTable head={['Sub-agent', { label: 'Students', right: true }, { label: 'Offers', right: true }, { label: 'Enrolled', right: true }]}>
            {subs.map((s) => (
              <tr key={s.partnerId} className="border-t border-line">
                <td className="px-4 py-2.5 text-ink-900">{s.name}</td>
                <td className="tnum px-4 py-2.5 text-right">{s.students}</td>
                <td className="tnum px-4 py-2.5 text-right">{s.offers}</td>
                <td className="tnum px-4 py-2.5 text-right">{s.enrolled}</td>
              </tr>
            ))}
          </MoneyTable>
        </Panel>
      )}
    </>
  );
}

export async function PartnerProfilePage() {
  const p = await me();
  return (
    <>
      <PageHeader title="Your organisation" subtitle={`${p.number} · ${PARTNER_KIND_LABEL[p.kind]} · ${PARTNER_TIER_LABEL[p.tier]}`} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Details" subtitle="To change these, message the consultancy">
          <dl className="space-y-2 text-[13px]">
            {(
              [
                ['Name', p.name],
                ['Contact', p.contactName],
                ['Email', p.email],
                ['Phone', p.phone],
                ['Address', [p.address, p.city, p.country].filter(Boolean).join(', ')],
                ['Website', p.website],
                ['Registration number', p.registrationNumber],
                ['Tax ID', p.taxId],
                ['Paid in', p.currency],
                ['Tax withheld', `${p.effectiveWithholdingPercent}%`],
              ] as [string, string | null][]
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-ink-400">{k}</dt>
                <dd className="text-right text-ink-800">{v || '–'}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title="Bank account" subtitle="Where your payouts go">
          {p.bank && (
            <p className="mb-3 text-[13px] text-ink-800">
              {p.bank.accountTitle}
              <span className="block text-ink-500">
                {p.bank.bankName} · {p.bank.iban}
              </span>
            </p>
          )}
          {p.canManage ? <BankForm url="/api/partner-portal/bank" initial={p.bank} /> : <p className="text-[13px] text-ink-400">Your owner or an administrator sets it.</p>}
        </Panel>
        <Panel title="Registration papers" subtitle={KYC_STATUS_LABEL[p.kycStatus]} className="xl:col-span-2">
          <p className="mb-3 text-[12.5px] text-ink-500">Needed: {KYC_REQUIRED.map((k) => KYC_KIND_LABEL[k].toLowerCase()).join(', ')}. PDF or a photo.</p>
          {p.documents.length > 0 && (
            <div className="mb-4 divide-y divide-line rounded-lg border border-line">
              {p.documents.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
                  <a href={`/api/partner-portal/documents/${d.id}`} target="_blank" rel="noreferrer" className="text-ink-900 hover:text-brand-700">
                    {KYC_KIND_LABEL[d.kind]} <span className="text-ink-400">· {d.name}</span>
                  </a>
                  <span className="flex items-center gap-2">
                    {d.reviewNote && <span className="text-[12px] text-bad-700">{d.reviewNote}</span>}
                    <Pill tone={d.status === 'approved' ? 'ok' : d.status === 'rejected' ? 'bad' : 'warn'}>{d.status === 'pending' ? 'Being checked' : d.status === 'approved' ? 'Approved' : 'Rejected'}</Pill>
                  </span>
                </div>
              ))}
            </div>
          )}
          {p.canManage ? <KycUploadForm url="/api/partner-portal/documents" /> : <p className="text-[13px] text-ink-400">Your owner or an administrator uploads them.</p>}
        </Panel>
      </div>
    </>
  );
}
