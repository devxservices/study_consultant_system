import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ATTRIBUTION_MATCH_LABEL,
  EARNING_KIND_LABEL,
  EARNING_STATUS_LABEL,
  EARNING_STATUS_TONE,
  KYC_KIND_LABEL,
  KYC_REQUIRED,
  KYC_STATUS_LABEL,
  PARTNER_AGREEMENT_STATUS_LABEL,
  PARTNER_KIND_LABEL,
  PARTNER_MEMBER_ROLE_LABEL,
  PARTNER_RULE_BASIS_LABEL,
  PARTNER_STATUS_LABEL,
  PARTNER_STATUS_TONE,
  PARTNER_TIER_LABEL,
  PARTNER_TIERS,
  PARTNER_STATUSES,
  PAYMENT_METHOD_LABEL,
  PAYOUT_STATUS_LABEL,
  PAYOUT_STATUS_TONE,
  describeCondition,
  formatMoney,
  type AdvanceView,
  type AttributionConflictView,
  type AuthUser,
  type FinanceSettingsView,
  type InstitutionSummaryView,
  type LedgerAccountView,
  type Paginated,
  type PartnerAgreementView,
  type PartnerEarningView,
  type PartnerMessageView,
  type PartnerPerformanceRow,
  type PartnerRuleView,
  type PartnerSettingsView,
  type PartnerStudentView,
  type PartnerSummaryView,
  type PartnerTier,
  type PartnerView,
  type PayoutView,
} from '@crm/shared';
import { ApiError, apiFetch, qs } from '@/lib/api';
import { formatDate, relativeDays } from '@/lib/format';
import { can } from '@/lib/permissions';
import { Card, EmptyState, LinkButton, PageHeader, Panel, Pill, cx } from '../ui';
import { ActionButton, ReasonAction } from '../forms';
import { NoAccess } from '../no-access';
import { Pagination } from '../client-table';
import { IconPlus, IconPrinter } from '../icons';
import { MoneyTable } from '../finance/workspace';
import {
  AddMemberForm,
  AdjustEarning,
  AgreementDraft,
  AssignPartner,
  BankForm,
  ConflictDecision,
  CreatePayout,
  GiveAdvance,
  KycReview,
  KycUploadForm,
  MemberActions,
  MessageComposer,
  PartnerForm,
  PartnerSettingsForm,
  PayPayout,
  RuleEditor,
  StatusControl,
  SwitchTabs,
  TierControl,
} from './partner-forms';

export const partnersBase = (user: AuthUser) => (user.role === 'manager' ? '/overview/partners' : '/desk/partners');
const clientsBase = (user: AuthUser) => (user.role === 'manager' ? '/overview/clients' : '/desk/clients');

type Section = 'partners' | 'conflicts' | 'payouts' | 'rules' | 'leaderboard' | 'settings';

function SectionTabs({ user, active, conflicts }: { user: AuthUser; active: Section; conflicts?: number }) {
  const base = partnersBase(user);
  return (
    <SwitchTabs
      active={active}
      tabs={[
        { key: 'partners', label: 'Partners', href: base },
        { key: 'conflicts', label: 'Who a student belongs to', href: `${base}/conflicts`, badge: conflicts },
        { key: 'payouts', label: 'Payouts', href: `${base}/payouts` },
        { key: 'rules', label: 'Commission rules', href: `${base}/rules` },
        { key: 'leaderboard', label: 'Leaderboard', href: `${base}/leaderboard` },
        { key: 'settings', label: 'Settings', href: `${base}/settings` },
      ]}
    />
  );
}

function money(list: { currency: string; amount: number }[]) {
  return list.length ? list.map((x) => formatMoney(x.amount, x.currency)).join(' + ') : '–';
}

async function load<T>(path: string): Promise<T> {
  try {
    return await apiFetch<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
}

const staffOptions = () =>
  apiFetch<{ id: string; name: string }[]>('/commissions/staff-options').catch(() =>
    apiFetch<{ id: string; name: string }[]>('/tasks/assignees').catch(() => [] as { id: string; name: string }[]),
  );
const moneyAccounts = () =>
  apiFetch<LedgerAccountView[]>('/finance/account-options')
    .then((all) => all.filter((a) => a.active && (a.subtype === 'cash' || a.subtype === 'bank' || a.subtype === 'clearing')).map((a) => ({ id: a.id, name: a.name })))
    .catch(() => [] as { id: string; name: string }[]);
const baseCurrency = () =>
  apiFetch<FinanceSettingsView>('/finance/settings')
    .then((s) => s.baseCurrency)
    .catch(() => 'PKR');

/* ------------------------------------------------------------------ */
/* The list                                                             */
/* ------------------------------------------------------------------ */

export async function PartnersListPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!can(user, 'partner.view')) return <NoAccess title="Partners" permission="partner.view" />;
  const base = partnersBase(user);
  const status = (PARTNER_STATUSES as readonly string[]).includes(query.status ?? '') ? query.status! : 'all';
  const pageNo = Math.max(1, Number(query.page) || 1);
  const [list, conflicts] = await Promise.all([
    apiFetch<Paginated<PartnerSummaryView>>(`/partners${qs({ status, tier: query.tier, q: query.q, page: pageNo })}`),
    apiFetch<AttributionConflictView[]>('/partners/conflicts').catch(() => []),
  ]);
  const href = (x: Record<string, string | number | undefined>) => `${base}${qs({ status, tier: query.tier, q: query.q, ...x })}`;
  return (
    <>
      <PageHeader
        title="Partners"
        subtitle="Sub-agents and referral partners who bring you students - their papers, agreements, students and what you owe them."
        actions={
          can(user, 'partner.manage') ? (
            <LinkButton href={`${base}/new`}>
              <IconPlus size={16} />
              Add partner
            </LinkButton>
          ) : undefined
        }
      />
      <SectionTabs user={user} active="partners" conflicts={conflicts.length} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {['all', ...PARTNER_STATUSES].map((s) => (
          <Link key={s} href={href({ status: s, page: undefined })} className={cx('rounded-full px-3 py-1 text-[12.5px] font-medium', status === s ? 'bg-ink-900 text-paper' : 'bg-ink-100 text-ink-600 hover:bg-ink-200')}>
            {s === 'all' ? 'All' : PARTNER_STATUS_LABEL[s as keyof typeof PARTNER_STATUS_LABEL]}
          </Link>
        ))}
        <form action={base} className="ml-auto flex flex-wrap items-center gap-2 text-[13px]">
          <input type="hidden" name="status" value={status} />
          <select name="tier" defaultValue={query.tier ?? ''} className="h-9 rounded-lg border border-line-strong bg-paper px-2">
            <option value="">Any tier</option>
            {PARTNER_TIERS.map((t) => (
              <option key={t} value={t}>
                {PARTNER_TIER_LABEL[t]}
              </option>
            ))}
          </select>
          <input name="q" defaultValue={query.q} placeholder="Name or email" className="h-9 w-48 rounded-lg border border-line-strong bg-paper px-2.5" />
          <button className="h-9 rounded-lg bg-ink-900 px-3 font-medium text-paper">Filter</button>
        </form>
      </div>
      <Card className="overflow-hidden">
        {list.items.length === 0 ? (
          <EmptyState title="No partners here" description="Add the sub-agents you work with, or switch on the public application page under Settings." />
        ) : (
          <MoneyTable head={['Partner', 'Status', 'Papers · agreement', { label: 'Students', right: true }, { label: 'Enrolled', right: true }, { label: 'Owed', right: true }]}>
            {list.items.map((p) => (
              <tr key={p.id} className="border-t border-line hover:bg-ink-50/60">
                <td className="px-4 py-2.5">
                  <Link href={`${base}/${p.id}`} className="font-medium text-ink-950 hover:text-brand-700">
                    {p.name}
                  </Link>
                  <span className="block text-[11.5px] text-ink-400">
                    {p.number} · {PARTNER_KIND_LABEL[p.kind]} · {PARTNER_TIER_LABEL[p.tier]} · {p.city ? `${p.city}, ` : ''}
                    {p.country}
                    {p.parentName ? ` · under ${p.parentName}` : ''}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <Pill tone={PARTNER_STATUS_TONE[p.status]}>{PARTNER_STATUS_LABEL[p.status]}</Pill>
                </td>
                <td className="px-4 py-2.5 text-[12.5px] text-ink-600">
                  {KYC_STATUS_LABEL[p.kycStatus]} · {p.agreementStatus ? PARTNER_AGREEMENT_STATUS_LABEL[p.agreementStatus] : 'no agreement'}
                </td>
                <td className="tnum px-4 py-2.5 text-right">{p.students}</td>
                <td className="tnum px-4 py-2.5 text-right">{p.enrolled}</td>
                <td className="tnum px-4 py-2.5 text-right font-medium">{money(p.payable)}</td>
              </tr>
            ))}
          </MoneyTable>
        )}
      </Card>
      <Pagination data={list} buildHref={(n) => href({ page: n })} />
    </>
  );
}

export async function NewPartnerPage({ user }: { user: AuthUser }) {
  if (!can(user, 'partner.manage')) return <NoAccess title="Add a partner" permission="partner.manage" />;
  const base = partnersBase(user);
  const [staff, parents] = await Promise.all([staffOptions(), apiFetch<{ id: string; name: string }[]>('/partners/options')]);
  return (
    <>
      <PageHeader title="Add a partner" subtitle="They start onboarding: their papers and the agreement come next." breadcrumb={[{ href: base, label: 'Partners' }, { label: 'New' }]} />
      <Card className="max-w-4xl p-5">
        <PartnerForm initial={null} base={base} staff={staff} parents={parents} canEdit />
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* One partner                                                          */
/* ------------------------------------------------------------------ */

const TABS = ['overview', 'team', 'papers', 'agreement', 'students', 'money', 'messages'] as const;
type Tab = (typeof TABS)[number];

export async function PartnerPage({ user, id, tab: rawTab }: { user: AuthUser; id: string; tab?: string }) {
  if (!can(user, 'partner.view')) return <NoAccess title="Partners" permission="partner.view" />;
  const base = partnersBase(user);
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? '') ? (rawTab as Tab) : 'overview';
  const p = await load<PartnerView>(`/partners/${id}`);
  const manage = can(user, 'partner.manage');
  const pay = can(user, 'payout.manage');
  const missing = [
    ...(p.kycStatus !== 'approved' ? ['papers approved'] : []),
    ...(p.agreementStatus !== 'signed' ? ['agreement signed'] : []),
    ...(p.members.filter((m) => m.active).length === 0 ? ['a login'] : []),
  ];
  return (
    <>
      <PageHeader
        title={p.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Pill tone={PARTNER_STATUS_TONE[p.status]}>{PARTNER_STATUS_LABEL[p.status]}</Pill>
            <span>
              {p.number} · {PARTNER_KIND_LABEL[p.kind]} · {PARTNER_TIER_LABEL[p.tier]} · {p.students} students, {p.enrolled} enrolled
              {p.parentName ? ` · sub-agent of ${p.parentName}` : ''}
            </span>
          </span>
        }
        breadcrumb={[{ href: base, label: 'Partners' }, { label: p.name }]}
      />
      <SwitchTabs
        active={tab}
        tabs={TABS.map((t) => ({
          key: t,
          label: { overview: 'Overview', team: 'Logins', papers: 'Papers', agreement: 'Agreement', students: 'Students', money: 'Money', messages: 'Messages' }[t],
          href: `${base}/${id}?tab=${t}`,
          badge: t === 'papers' ? p.documents.filter((d) => d.status === 'pending').length || undefined : undefined,
        }))}
      />
      {tab === 'overview' && <OverviewTab user={user} p={p} manage={manage} pay={pay} missing={missing} />}
      {tab === 'team' && (
        <Panel title="Their logins" subtitle="Owners and administrators manage the team, sign and see money; counsellors work with students" action={manage && p.status !== 'terminated' ? <AddMemberForm url={`/api/partners/${id}/members`} roles={['owner', 'admin', 'counsellor']} /> : undefined}>
          {p.members.length === 0 ? (
            <p className="text-[13px] text-ink-400">Nobody there can sign in yet. Add the owner first - they sign the agreement.</p>
          ) : (
            <div className="divide-y divide-line">
              {p.members.map((m) => (
                <div key={m.id} className={cx('flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13px]', !m.active && 'opacity-60')}>
                  <span>
                    <span className="font-medium text-ink-900">{m.fullName}</span>
                    <span className="text-ink-500">
                      {' '}
                      · {m.email} · {PARTNER_MEMBER_ROLE_LABEL[m.role]}
                      {m.lastSeenAt ? ` · last signed in ${relativeDays(m.lastSeenAt)}` : ' · never signed in'}
                    </span>
                  </span>
                  {manage && <MemberActions url={`/api/partners/${id}/members/${m.id}`} member={m} roles={['owner', 'admin', 'counsellor']} />}
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
      {tab === 'papers' && <PapersTab p={p} manage={manage} />}
      {tab === 'agreement' && <AgreementTab id={id} manage={manage} />}
      {tab === 'students' && <StudentsTab user={user} id={id} />}
      {tab === 'money' && <MoneyTab user={user} p={p} pay={pay} />}
      {tab === 'messages' && <MessagesTab id={id} />}
    </>
  );
}

async function OverviewTab({ user, p, manage, pay, missing }: { user: AuthUser; p: PartnerView; manage: boolean; pay: boolean; missing: string[] }) {
  const base = partnersBase(user);
  const [staff, parents, board] = await Promise.all([
    manage ? staffOptions() : Promise.resolve([]),
    manage ? apiFetch<{ id: string; name: string }[]>('/partners/options') : Promise.resolve([]),
    apiFetch<{ rows: (PartnerPerformanceRow & { suggestedTier: PartnerTier })[] }>('/partners/leaderboard').catch(() => ({ rows: [] })),
  ]);
  const perf = board.rows.find((r) => r.partnerId === p.id);
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        {p.source === 'applied' && p.application && (
          <Panel title="Their application" subtitle={`Applied ${formatDate(p.createdAt)}`}>
            <p className="text-[13px] text-ink-700">{p.application.studentsPerYear ? `About ${p.application.studentsPerYear} students a year. ` : ''}</p>
            {p.application.message && <p className="mt-1 whitespace-pre-line text-[13px] text-ink-700">{p.application.message}</p>}
          </Panel>
        )}
        <Panel title="Details">
          <PartnerForm initial={p} base={base} staff={staff} parents={parents} canEdit={manage} />
        </Panel>
      </div>
      <div className="space-y-5">
        {manage && (
          <Panel title="Status">
            <StatusControl id={p.id} status={p.status} missing={missing} />
          </Panel>
        )}
        {manage && (
          <Panel title="Tier" subtitle="Decides which commission rules apply">
            <TierControl id={p.id} tier={p.tier} suggested={perf?.suggestedTier ?? null} />
          </Panel>
        )}
        <Panel title="Last 12 months">
          {perf ? (
            <dl className="grid grid-cols-2 gap-3 text-[12.5px]">
              {(
                [
                  ['Rank', `#${perf.rank}`],
                  ['Students', perf.students],
                  ['Applications', perf.applications],
                  ['Offers', perf.offers],
                  ['Visas', perf.visas],
                  ['Enrolled', perf.enrolled],
                  ['Conversion', `${perf.conversionPercent}%`],
                  ['Earned', money(perf.earned)],
                ] as [string, string | number][]
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-ink-400">{k}</dt>
                  <dd className="tnum font-medium text-ink-900">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-[13px] text-ink-400">No results yet.</p>
          )}
        </Panel>
        <Panel title="Bank account" subtitle={pay ? 'Where payouts go' : 'Shown in full to those who pay partners'}>
          {p.bank ? (
            <p className="mb-3 text-[13px] text-ink-800">
              {p.bank.accountTitle}
              <span className="block text-ink-500">
                {p.bank.bankName} · {p.bank.iban}
                {p.bank.swift ? ` · ${p.bank.swift}` : ''}
              </span>
            </p>
          ) : (
            <p className="mb-3 text-[13px] text-ink-400">None yet. The partner can add it in their portal.</p>
          )}
          {pay && <BankForm url={`/api/partners/${p.id}/bank`} initial={p.bank} />}
        </Panel>
        {p.subAgents.length > 0 && (
          <Panel title="Sub-agents">
            <ul className="space-y-1.5 text-[13px]">
              {p.subAgents.map((s) => (
                <li key={s.id} className="flex items-center justify-between">
                  <Link href={`${base}/${s.id}`} className="text-ink-900 hover:text-brand-700">
                    {s.name}
                  </Link>
                  <Pill tone={PARTNER_STATUS_TONE[s.status]}>{PARTNER_STATUS_LABEL[s.status]}</Pill>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}

function PapersTab({ p, manage }: { p: PartnerView; manage: boolean }) {
  return (
    <Panel title="Registration papers" subtitle={`${KYC_STATUS_LABEL[p.kycStatus]}. Needed: ${KYC_REQUIRED.map((k) => KYC_KIND_LABEL[k].toLowerCase()).join(', ')}.`}>
      {p.documents.length === 0 ? (
        <p className="mb-4 text-[13px] text-ink-400">Nothing yet. The partner uploads them from its portal, or you can here.</p>
      ) : (
        <div className="mb-4 divide-y divide-line rounded-lg border border-line">
          {p.documents.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[13px]">
              <span className="min-w-0">
                <a href={`/api/partners/${p.id}/documents/${d.id}`} target="_blank" rel="noreferrer" className="font-medium text-ink-900 hover:text-brand-700">
                  {KYC_KIND_LABEL[d.kind]}
                </a>
                <span className="block text-[11.5px] text-ink-400">
                  {d.name} · {formatDate(d.createdAt)}
                  {d.uploadedByName ? ` · ${d.uploadedByName}` : ''}
                  {d.reviewNote ? ` · “${d.reviewNote}”` : ''}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Pill tone={d.status === 'approved' ? 'ok' : d.status === 'rejected' ? 'bad' : 'warn'}>{d.status === 'pending' ? 'To check' : d.status === 'approved' ? 'Approved' : 'Rejected'}</Pill>
                {manage && d.status === 'pending' && <KycReview partnerId={p.id} documentId={d.id} />}
              </span>
            </div>
          ))}
        </div>
      )}
      {manage && <KycUploadForm url={`/api/partners/${p.id}/documents`} />}
    </Panel>
  );
}

async function AgreementTab({ id, manage }: { id: string; manage: boolean }) {
  const list = await apiFetch<PartnerAgreementView[]>(`/partners/${id}/agreements`);
  const draft = list.find((a) => a.status === 'draft');
  const template = manage && !draft ? await apiFetch<{ title: string; body: string; validFrom: string }>(`/partners/${id}/agreements/draft`).catch(() => null) : null;
  return (
    <div className="space-y-5">
      {manage && (
        <Panel title={draft ? `Draft (version ${draft.version})` : 'A new agreement'} subtitle="Written here, sent to the partner's owner or administrator, signed in their portal" action={draft ? <ActionButton url={`/api/partners/${id}/agreements/${draft.id}/send`} variant="primary">Send for signature</ActionButton> : undefined}>
          <AgreementDraft partnerId={id} draft={template} initial={draft ? { id: draft.id, title: draft.title, body: draft.body, validFrom: draft.validFrom, validTo: draft.validTo } : null} />
        </Panel>
      )}
      {list
        .filter((a) => a.status !== 'draft')
        .map((a) => (
          <Panel
            key={a.id}
            title={`${a.title} (version ${a.version})`}
            subtitle={`${PARTNER_AGREEMENT_STATUS_LABEL[a.status]}${a.sentAt ? ` · sent ${formatDate(a.sentAt)}${a.sentByName ? ` by ${a.sentByName}` : ''}` : ''}${a.signedAt ? ` · signed ${formatDate(a.signedAt)} by ${a.signerName}, ${a.signerTitle}` : ''}`}
            action={
              <span className="flex flex-wrap gap-2">
                <a href={`/api/partners/${id}/agreements/${a.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-paper px-3 text-[12.5px] font-medium text-ink-700 hover:bg-ink-50">
                  <IconPrinter size={14} />
                  {a.status === 'signed' ? 'Signed copy and certificate' : 'PDF'}
                </a>
                {manage && a.status !== 'void' && <ReasonAction label="Withdraw" confirmLabel="Withdraw it" url={`/api/partners/${id}/agreements/${a.id}/withdraw`} explanation={a.status === 'signed' ? 'End this agreement. A new one will need signing.' : 'It will no longer be offered for signature.'} />}
              </span>
            }
          >
            {a.status === 'signed' && (
              <div className="mb-3 rounded-lg bg-ok-50 p-3 text-[12.5px] text-ink-700">
                {a.signatureKind === 'drawn' && a.signature ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.signature} alt={`Signature of ${a.signerName}`} className="mb-2 h-14 bg-paper" />
                ) : (
                  <p className="mb-1 font-serif text-[20px] italic text-ink-900">{a.signature}</p>
                )}
                Signed from {a.signerIp ?? 'an unrecorded address'} · fingerprint <span className="font-mono">{a.documentHash?.slice(0, 16)}…</span>
              </div>
            )}
            <div className="max-h-80 overflow-y-auto whitespace-pre-line rounded-lg border border-line p-3 text-[12.5px] leading-relaxed text-ink-700">{a.body}</div>
          </Panel>
        ))}
    </div>
  );
}

async function StudentsTab({ user, id }: { user: AuthUser; id: string }) {
  const students = await apiFetch<PartnerStudentView[]>(`/partners/${id}/students`);
  const cBase = clientsBase(user);
  return (
    <Card className="overflow-hidden">
      {students.length === 0 ? (
        <EmptyState title="No students yet" description="Students the partner registers in its portal, or that you credit to it from the student's page, show here." />
      ) : (
        <MoneyTable head={['Student', 'Applications', 'Consultant', 'Registered']}>
          {students.map((s) => (
            <tr key={s.clientId} className="border-t border-line">
              <td className="px-4 py-2.5">
                <Link href={`${cBase}/${s.clientId}`} className="font-medium text-ink-950 hover:text-brand-700">
                  {s.fullName}
                </Link>
                <span className="block text-[11.5px] text-ink-400">
                  {s.email}
                  {s.viaPartnerName ? ` · via ${s.viaPartnerName}` : ''}
                </span>
              </td>
              <td className="px-4 py-2.5 text-[12.5px] text-ink-700">
                {s.applications.length === 0
                  ? '–'
                  : s.applications.map((a) => (
                      <span key={a.id} className="block">
                        {a.reference} · {a.university ?? a.country} · {a.stageLabel}
                      </span>
                    ))}
              </td>
              <td className="px-4 py-2.5 text-ink-600">{s.consultantName ?? '–'}</td>
              <td className="px-4 py-2.5 text-ink-500">
                {formatDate(s.attributedAt ?? s.createdAt)}
                {s.registeredByName ? <span className="block text-[11.5px]">by {s.registeredByName}</span> : null}
              </td>
            </tr>
          ))}
        </MoneyTable>
      )}
    </Card>
  );
}

async function MoneyTab({ user, p, pay }: { user: AuthUser; p: PartnerView; pay: boolean }) {
  const base = partnersBase(user);
  const [earnings, payouts, advances, accounts, options] = await Promise.all([
    apiFetch<Paginated<PartnerEarningView>>(`/partners/earnings${qs({ partnerId: p.id, pageSize: 100 })}`),
    apiFetch<PayoutView[]>(`/partners/payouts${qs({ partnerId: p.id })}`),
    apiFetch<AdvanceView[]>(`/partners/advances${qs({ partnerId: p.id })}`),
    pay ? moneyAccounts() : Promise.resolve([]),
    pay ? apiFetch<{ id: string; name: string; currency: string }[]>('/partners/options') : Promise.resolve([]),
  ]);
  return (
    <div className="space-y-5">
      <Panel title="Owed" subtitle={`${money(p.payable)} owed now · tax withheld at ${p.effectiveWithholdingPercent}%`}>
        {pay && p.status !== 'suspended' && p.status !== 'applied' && (
          <CreatePayout partners={options} partnerId={p.id} currency={p.currency} payoutsBase={`${base}/payouts`} />
        )}
        {p.status === 'suspended' && <p className="text-[13px] text-warn-700">Suspended: payouts wait until it is active again.</p>}
      </Panel>
      <Panel title="Earnings" subtitle="Each one booked as it was earned" action={pay ? <AdjustEarning partnerId={p.id} currency={p.currency} /> : undefined} bodyClassName="">
        <EarningsTable earnings={earnings.items} clientsHref={clientsBase(user)} payoutsHref={`${base}/payouts`} />
      </Panel>
      <Panel title="Payouts" bodyClassName="">
        <PayoutsTable payouts={payouts} href={`${base}/payouts`} />
      </Panel>
      <Panel title="Advances" subtitle="Paid ahead, taken back from payouts" action={pay && p.status === 'active' ? <GiveAdvance partnerId={p.id} accounts={accounts} currency={p.currency} /> : undefined}>
        {advances.length === 0 ? (
          <p className="text-[13px] text-ink-400">None.</p>
        ) : (
          <div className="divide-y divide-line">
            {advances.map((a) => (
              <div key={a.id} className={cx('flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]', a.voided && 'opacity-60')}>
                <span>
                  {a.number} · {formatDate(a.givenOn)} · {a.reason}
                  {a.voided ? ' · voided' : ''}
                </span>
                <span className="flex items-center gap-3">
                  <span className="tnum">
                    {formatMoney(a.amount, a.currency)} <span className="text-ink-400">· {formatMoney(a.outstanding, a.currency)} still owed</span>
                  </span>
                  {pay && !a.voided && a.recovered === 0 && <ReasonAction label="Void" confirmLabel="Void the advance" url={`/api/partners/advances/${a.id}/void`} explanation="It was recorded by mistake. The payment is reversed in the books." />}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

export function EarningsTable({ earnings, clientsHref, payoutsHref }: { earnings: PartnerEarningView[]; clientsHref: string | null; payoutsHref: string | null }) {
  if (!earnings.length) return <p className="px-5 pb-5 text-[13px] text-ink-400">Nothing earned yet.</p>;
  return (
    <MoneyTable head={['Earned', 'What for', 'Student', 'Status', { label: 'Amount', right: true }]}>
      {earnings.map((e) => (
        <tr key={e.id} className={cx('border-t border-line', e.status === 'reversed' && 'opacity-60')}>
          <td className="px-4 py-2.5 text-ink-500">
            {formatDate(e.earnedOn)}
            <span className="block text-[11.5px]">{e.number}</span>
          </td>
          <td className="px-4 py-2.5 text-[12.5px] text-ink-700">
            <span className="font-medium text-ink-900">{EARNING_KIND_LABEL[e.kind]}</span>
            {e.fromPartnerName ? ` · ${e.fromPartnerName}` : ''}
            <span className="block text-ink-500">{e.description}</span>
          </td>
          <td className="px-4 py-2.5 text-ink-700">
            {e.clientName ? (clientsHref && e.clientId ? <Link href={`${clientsHref}/${e.clientId}`} className="hover:text-brand-700">{e.clientName}</Link> : e.clientName) : '–'}
          </td>
          <td className="px-4 py-2.5">
            <Pill tone={EARNING_STATUS_TONE[e.status]}>{EARNING_STATUS_LABEL[e.status]}</Pill>
            {e.payoutNumber && (payoutsHref && e.payoutId ? <Link href={`${payoutsHref}/${e.payoutId}`} className="block text-[11.5px] text-brand-700 hover:underline">{e.payoutNumber}</Link> : <span className="block text-[11.5px] text-ink-400">{e.payoutNumber}</span>)}
          </td>
          <td className={cx('tnum px-4 py-2.5 text-right font-medium', e.amount < 0 && 'text-bad-700')}>{formatMoney(e.amount, e.currency)}</td>
        </tr>
      ))}
    </MoneyTable>
  );
}

export function PayoutsTable({ payouts, href }: { payouts: PayoutView[]; href: string | null }) {
  if (!payouts.length) return <p className="px-5 pb-5 text-[13px] text-ink-400">No payouts yet.</p>;
  return (
    <MoneyTable head={['Payout', 'Partner', 'Status', { label: 'Earned', right: true }, { label: 'Withheld', right: true }, { label: 'Paid', right: true }]}>
      {payouts.map((p) => (
        <tr key={p.id} className="border-t border-line">
          <td className="px-4 py-2.5">
            {href ? (
              <Link href={`${href}/${p.id}`} className="font-medium text-ink-950 hover:text-brand-700">
                {p.number}
              </Link>
            ) : (
              <span className="font-medium text-ink-950">{p.number}</span>
            )}
            <span className="block text-[11.5px] text-ink-400">
              {p.periodLabel}
              {p.paidOn ? ` · paid ${formatDate(p.paidOn)}` : ''}
            </span>
          </td>
          <td className="px-4 py-2.5 text-ink-700">{p.partnerName}</td>
          <td className="px-4 py-2.5">
            <Pill tone={PAYOUT_STATUS_TONE[p.status]}>{PAYOUT_STATUS_LABEL[p.status]}</Pill>
          </td>
          <td className="tnum px-4 py-2.5 text-right">{formatMoney(p.gross, p.currency)}</td>
          <td className="tnum px-4 py-2.5 text-right text-ink-500">{p.withholding ? formatMoney(p.withholding, p.currency) : '–'}</td>
          <td className="tnum px-4 py-2.5 text-right font-medium">{formatMoney(p.net, p.currency)}</td>
        </tr>
      ))}
    </MoneyTable>
  );
}

async function MessagesTab({ id }: { id: string }) {
  const messages = await apiFetch<PartnerMessageView[]>(`/partners/${id}/messages`);
  return (
    <Panel title="Messages" subtitle="Your conversation with the partner">
      <MessageList messages={messages} mineIsPartner={false} />
      <div className="mt-4">
        <MessageComposer url={`/api/partners/${id}/messages`} />
      </div>
    </Panel>
  );
}

export function MessageList({ messages, mineIsPartner }: { messages: PartnerMessageView[]; mineIsPartner: boolean }) {
  if (!messages.length) return <p className="text-[13px] text-ink-400">No messages yet.</p>;
  return (
    <div className="max-h-[480px] space-y-2 overflow-y-auto">
      {messages.map((m) => {
        const mine = m.fromPartner === mineIsPartner;
        return (
          <div key={m.id} className={cx('max-w-[80%] rounded-xl px-3 py-2 text-[13px]', mine ? 'ml-auto bg-brand-50 text-ink-900' : 'bg-ink-50 text-ink-900')}>
            <p className="mb-0.5 text-[11px] text-ink-500">
              {m.authorName} · {formatDate(m.createdAt)}
              {m.clientName ? ` · about ${m.clientName}` : ''}
            </p>
            <p className="whitespace-pre-line">{m.body}</p>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The conflict queue                                                   */
/* ------------------------------------------------------------------ */

export async function ConflictsPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!can(user, 'partner.view')) return <NoAccess title="Partners" permission="partner.view" />;
  const base = partnersBase(user);
  const status = query.status === 'decided' ? 'decided' : 'open';
  const [list, open] = await Promise.all([apiFetch<AttributionConflictView[]>(`/partners/conflicts${qs({ status })}`), apiFetch<AttributionConflictView[]>('/partners/conflicts')]);
  const manage = can(user, 'partner.manage');
  return (
    <>
      <PageHeader title="Who a student belongs to" subtitle="A partner registered a student someone already has. The first to register keeps them unless you decide otherwise." />
      <SectionTabs user={user} active="conflicts" conflicts={open.length} />
      <div className="mb-3 flex gap-2">
        {(['open', 'decided'] as const).map((s) => (
          <Link key={s} href={`${base}/conflicts${qs({ status: s === 'open' ? undefined : s })}`} className={cx('rounded-full px-3 py-1 text-[12.5px] font-medium', status === s ? 'bg-ink-900 text-paper' : 'bg-ink-100 text-ink-600 hover:bg-ink-200')}>
            {s === 'open' ? 'To decide' : 'Decided'}
          </Link>
        ))}
      </div>
      {list.length === 0 ? (
        <Card>
          <EmptyState title={status === 'open' ? 'Nothing to decide' : 'Nothing decided yet'} description="Claims on students someone else already has appear here." />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14.5px] font-medium text-ink-950">
                    <Link href={`${clientsBase(user)}/${c.clientId}`} className="hover:text-brand-700">
                      {c.clientName}
                    </Link>{' '}
                    <span className="text-[12.5px] font-normal text-ink-500">· same {c.matchedOn.map((m) => ATTRIBUTION_MATCH_LABEL[m]).join(', ')}</span>
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-ink-600">
                    With <span className="font-medium">{c.currentPartnerName ?? 'the consultancy itself'}</span> since {formatDate(c.registeredAt)}; claimed by{' '}
                    <span className="font-medium">{c.claimantPartnerName}</span>
                    {c.claimedByName ? ` (${c.claimedByName})` : ''} {relativeDays(c.createdAt)}.
                  </p>
                  <p className="mt-1 text-[12px] text-ink-500">
                    They entered: {c.submitted.fullName} · {c.submitted.email} · {c.submitted.phone}
                    {c.submitted.passportNumber ? ` · ${c.submitted.passportNumber}` : ''}
                    {c.submitted.notes ? ` · “${c.submitted.notes}”` : ''}
                  </p>
                  {c.lapsed && <Pill tone="warn" className="mt-2">The first registration has lapsed: no live application and older than the window</Pill>}
                  {c.status !== 'open' && (
                    <p className="mt-2 text-[12.5px] text-ink-700">
                      {c.status === 'transferred' ? 'Moved to the claimant' : 'Kept with the first'} by {c.decidedByName} {c.decidedAt ? formatDate(c.decidedAt) : ''}: {c.decisionNote}
                    </p>
                  )}
                </div>
              </div>
              {manage && c.status === 'open' && (
                <div className="mt-3 border-t border-line pt-3">
                  <ConflictDecision id={c.id} currentName={c.currentPartnerName ?? 'the consultancy'} claimantName={c.claimantPartnerName} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Payouts                                                              */
/* ------------------------------------------------------------------ */

export async function PayoutsPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!can(user, 'partner.view')) return <NoAccess title="Partners" permission="partner.view" />;
  const base = partnersBase(user);
  const pay = can(user, 'payout.manage');
  const [list, owed, options] = await Promise.all([
    apiFetch<PayoutView[]>(`/partners/payouts${qs({ status: query.status })}`),
    apiFetch<{ partnerId: string; partnerName: string; currency: string; amount: number; earnings: number }[]>('/partners/payouts/owed'),
    pay ? apiFetch<{ id: string; name: string; currency: string }[]>('/partners/options') : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title="Payouts" subtitle="What partners are owed, and paying them - prepared, approved by a second person, then paid." />
      <SectionTabs user={user} active="payouts" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="All payouts" bodyClassName="">
          <PayoutsTable payouts={list} href={`${base}/payouts`} />
        </Panel>
        <div className="space-y-5">
          <Panel title="Owed now" subtitle="Earnings not yet on a payout">
            {owed.length === 0 ? (
              <p className="text-[13px] text-ink-400">Nobody is owed anything.</p>
            ) : (
              <ul className="space-y-1.5 text-[13px]">
                {owed.map((o) => (
                  <li key={`${o.partnerId}-${o.currency}`} className="flex items-center justify-between gap-2">
                    <Link href={`${base}/${o.partnerId}?tab=money`} className="text-ink-900 hover:text-brand-700">
                      {o.partnerName}
                    </Link>
                    <span className={cx('tnum font-medium', o.amount < 0 && 'text-bad-700')}>{formatMoney(o.amount, o.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {pay && (
            <Panel title="Prepare a payout">
              <CreatePayout partners={options} partnerId={null} currency={null} payoutsBase={`${base}/payouts`} />
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

export async function PayoutPage({ user, id }: { user: AuthUser; id: string }) {
  if (!can(user, 'partner.view')) return <NoAccess title="Partners" permission="partner.view" />;
  const base = partnersBase(user);
  const p = await load<PayoutView>(`/partners/payouts/${id}`);
  const pay = can(user, 'payout.manage');
  const [accounts, currency] = await Promise.all([pay && p.status === 'approved' ? moneyAccounts() : Promise.resolve([]), baseCurrency()]);
  return (
    <>
      <PageHeader
        title={`${p.number} · ${p.partnerName}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Pill tone={PAYOUT_STATUS_TONE[p.status]}>{PAYOUT_STATUS_LABEL[p.status]}</Pill>
            <span>
              {p.periodLabel} · prepared by {p.createdByName ?? 'someone'} {formatDate(p.createdAt)}
              {p.approvedByName ? ` · approved by ${p.approvedByName}` : ''}
              {p.paidOn ? ` · paid ${formatDate(p.paidOn)} from ${p.accountName}${p.method ? ` by ${PAYMENT_METHOD_LABEL[p.method].toLowerCase()}` : ''}${p.reference ? `, ref ${p.reference}` : ''}` : ''}
            </span>
          </span>
        }
        breadcrumb={[{ href: base, label: 'Partners' }, { href: `${base}/payouts`, label: 'Payouts' }, { label: p.number }]}
        actions={
          <a href={`/api/partners/payouts/${p.id}/statement`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink-700 hover:bg-ink-50">
            <IconPrinter size={15} />
            Statement
          </a>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="What it pays for" bodyClassName="">
          <EarningsTable earnings={p.earnings} clientsHref={clientsBase(user)} payoutsHref={null} />
          <div className="border-t border-line px-5 py-3 text-[13px]">
            <dl className="ml-auto max-w-xs space-y-1">
              <div className="flex justify-between">
                <dt className="text-ink-500">Earned</dt>
                <dd className="tnum">{formatMoney(p.gross, p.currency)}</dd>
              </div>
              {p.withholding > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ink-500">Tax withheld ({p.withholdingBp / 100}%)</dt>
                  <dd className="tnum">-{formatMoney(p.withholding, p.currency)}</dd>
                </div>
              )}
              {p.advanceRecovered > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ink-500">Advance taken back</dt>
                  <dd className="tnum">-{formatMoney(p.advanceRecovered, p.currency)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-line pt-1 font-medium">
                <dt>{p.status === 'paid' ? 'Paid' : 'To pay'}</dt>
                <dd className="tnum">{formatMoney(p.net, p.currency)}</dd>
              </div>
            </dl>
          </div>
        </Panel>
        {pay && (
          <Panel title="What happens next">
            <div className="space-y-3">
              {p.status === 'draft' && (
                <>
                  <p className="text-[12.5px] text-ink-500">Someone other than whoever prepared it approves it (unless that rule is off in Settings).</p>
                  <ActionButton url={`/api/partners/payouts/${p.id}/approve`} variant="primary">
                    Approve
                  </ActionButton>
                </>
              )}
              {p.status === 'approved' && <PayPayout id={p.id} accounts={accounts} currency={p.currency} baseCurrency={currency} />}
              {p.status !== 'void' && (
                <ReasonAction
                  label={p.status === 'paid' ? 'Void the payout' : 'Cancel the payout'}
                  confirmLabel="Void it"
                  url={`/api/partners/payouts/${p.id}/void`}
                  explanation={p.status === 'paid' ? 'The payment is reversed in the books; its earnings are owed again and any advance it took back is owed again.' : 'Its earnings go back to owed.'}
                />
              )}
              {p.status === 'void' && <p className="text-[13px] text-ink-500">Void: {p.voidReason}</p>}
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Rules, leaderboard, settings                                         */
/* ------------------------------------------------------------------ */

export async function RulesPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!can(user, 'partner.view')) return <NoAccess title="Partners" permission="partner.view" />;
  const manage = can(user, 'partner.manage');
  const all = query.all === '1';
  const [rules, partners, institutions] = await Promise.all([
    apiFetch<PartnerRuleView[]>(`/partners/rules${qs({ all: all ? 'true' : undefined })}`),
    manage ? apiFetch<{ id: string; name: string }[]>('/partners/options') : Promise.resolve([]),
    manage ? apiFetch<InstitutionSummaryView[]>('/institutions').then((l) => l.map((i) => ({ id: i.id, name: i.name }))) : Promise.resolve([]),
  ]);
  const base = partnersBase(user);
  return (
    <>
      <PageHeader title="Commission rules" subtitle="What partners earn. For each kind of earning, the most specific rule that fits applies: one partner, then its tier, then everyone." />
      <SectionTabs user={user} active="rules" />
      <div className="mb-3 flex items-center justify-between gap-2">
        <Link href={`${base}/rules${qs({ all: all ? undefined : '1' })}`} className="text-[12.5px] font-medium text-brand-700 hover:underline">
          {all ? 'Hide earlier versions' : 'Show earlier versions'}
        </Link>
        {manage && <RuleEditor rule={null} partners={partners} institutions={institutions} />}
      </div>
      {rules.length === 0 ? (
        <Card>
          <EmptyState title="No rules yet" description="Without a rule a partner earns nothing automatically. Add one: a share of university commission is the usual start." />
        </Card>
      ) : (
        <div className="space-y-3">
          {rules.map((r) => (
            <Card key={r.id} className={cx('p-4', (r.superseded || !r.active) && 'opacity-60')}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14.5px] font-medium text-ink-950">
                    {r.name} <span className="text-[12px] font-normal text-ink-400">v{r.version}</span>
                    {r.superseded && <Pill tone="neutral" className="ml-2">Replaced</Pill>}
                    {!r.active && !r.superseded && <Pill tone="neutral" className="ml-2">Not in use</Pill>}
                  </p>
                  <p className="text-[13px] text-ink-700">
                    {r.basis === 'fixed_per_student' ? `${formatMoney(Math.round(r.fixedAmount * 100), r.currency ?? 'PKR')} per enrolled student` : `${r.ratePercent}% · ${PARTNER_RULE_BASIS_LABEL[r.basis].toLowerCase()}`}
                    {r.basis === 'fee_share' ? ` (${r.feeCategories.join(', ')})` : ''}
                  </p>
                  <p className="text-[12px] text-ink-500">
                    For {r.partnerName ?? (r.tier ? `${PARTNER_TIER_LABEL[r.tier]} partners` : 'every partner')}
                    {r.institutionName ? ` · students at ${r.institutionName}` : ''} · from {formatDate(r.validFrom)}
                    {r.validTo ? ` to ${formatDate(r.validTo)}` : ''}
                    {r.conditions.length ? ` · only when ${r.conditions.map(describeCondition).join(' and ').toLowerCase()}` : ''} · {r.earnings} {r.earnings === 1 ? 'earning' : 'earnings'}
                  </p>
                </div>
                {manage && !r.superseded && <RuleEditor rule={r} partners={partners} institutions={institutions} />}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export async function LeaderboardPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!can(user, 'partner.view')) return <NoAccess title="Partners" permission="partner.view" />;
  const base = partnersBase(user);
  const board = await apiFetch<{ from: string; to: string; rows: (PartnerPerformanceRow & { suggestedTier: PartnerTier })[] }>(`/partners/leaderboard${qs({ from: query.from, to: query.to })}`);
  return (
    <>
      <PageHeader title="Leaderboard" subtitle={`Ranked by students enrolled, ${formatDate(board.from)} to ${formatDate(board.to)}.`} />
      <SectionTabs user={user} active="leaderboard" />
      <form action={`${base}/leaderboard`} className="mb-3 flex flex-wrap items-end gap-2 text-[13px]">
        <label className="text-ink-600">
          From <input type="date" name="from" defaultValue={board.from} className="ml-1 h-9 rounded-lg border border-line-strong bg-paper px-2" />
        </label>
        <label className="text-ink-600">
          To <input type="date" name="to" defaultValue={board.to} className="ml-1 h-9 rounded-lg border border-line-strong bg-paper px-2" />
        </label>
        <button className="h-9 rounded-lg bg-ink-900 px-3 font-medium text-paper">Show</button>
      </form>
      <Card className="overflow-hidden">
        {board.rows.length === 0 ? (
          <EmptyState title="No partners yet" description="Partners appear here once they are onboarding or active." />
        ) : (
          <MoneyTable head={['#', 'Partner', { label: 'Students', right: true }, { label: 'Applications', right: true }, { label: 'Offers', right: true }, { label: 'Visas', right: true }, { label: 'Enrolled', right: true }, { label: 'Conversion', right: true }, { label: 'Earned', right: true }, 'Tier']}>
            {board.rows.map((r) => (
              <tr key={r.partnerId} className="border-t border-line">
                <td className="tnum px-4 py-2.5 font-semibold text-ink-900">{r.rank}</td>
                <td className="px-4 py-2.5">
                  <Link href={`${base}/${r.partnerId}`} className="font-medium text-ink-950 hover:text-brand-700">
                    {r.name}
                  </Link>
                  <span className="block text-[11.5px] text-ink-400">{PARTNER_STATUS_LABEL[r.status]}</span>
                </td>
                <td className="tnum px-4 py-2.5 text-right">{r.students}</td>
                <td className="tnum px-4 py-2.5 text-right">{r.applications}</td>
                <td className="tnum px-4 py-2.5 text-right">{r.offers}</td>
                <td className="tnum px-4 py-2.5 text-right">{r.visas}</td>
                <td className="tnum px-4 py-2.5 text-right font-medium">{r.enrolled}</td>
                <td className="tnum px-4 py-2.5 text-right">{r.conversionPercent}%</td>
                <td className="tnum px-4 py-2.5 text-right">{money(r.earned)}</td>
                <td className="px-4 py-2.5 text-[12.5px]">
                  {PARTNER_TIER_LABEL[r.tier]}
                  {r.suggestedTier !== r.tier && <span className="block text-warn-700">reaches {PARTNER_TIER_LABEL[r.suggestedTier]}</span>}
                </td>
              </tr>
            ))}
          </MoneyTable>
        )}
      </Card>
    </>
  );
}

export async function PartnerSettingsPage({ user }: { user: AuthUser }) {
  if (!can(user, 'partner.view')) return <NoAccess title="Partners" permission="partner.view" />;
  const settings = await apiFetch<PartnerSettingsView>('/partners/settings');
  const manage = can(user, 'partner.manage');
  return (
    <>
      <PageHeader title="Partner settings" subtitle="Applications, who a student belongs to, payouts, tiers and the agreement template." />
      <SectionTabs user={user} active="settings" />
      <Card className="p-5">
        {manage ? (
          <PartnerSettingsForm settings={settings} />
        ) : (
          <p className="text-[13px] text-ink-500">You can read these; changing them needs “Manage partners”.</p>
        )}
        <p className="mt-5 text-[12.5px] text-ink-500">
          The public application page is at <span className="font-mono">/partners/apply</span> on your site.
        </p>
      </Card>
    </>
  );
}

/** A card for the student's page: who brought them, and changing it. */
export async function StudentPartnerCard({ user, clientId }: { user: AuthUser; clientId: string }) {
  const info = await apiFetch<{ partnerId: string | null; partnerName: string | null; attributedAt: string | null; canChange: boolean }>(`/partners/students/${clientId}`).catch(() => null);
  if (!info) return null;
  if (!info.partnerId && !info.canChange) return null;
  const options = info.canChange ? await apiFetch<{ id: string; name: string }[]>('/partners/options').catch(() => []) : [];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-[15.5px] font-medium text-ink-950">Brought by</h2>
        {info.canChange && <AssignPartner clientId={clientId} current={info.partnerId} options={options} />}
      </div>
      <p className="mt-1 text-[13.5px] text-ink-800">
        {info.partnerId ? (
          can(user, 'partner.view') ? (
            <Link href={`${partnersBase(user)}/${info.partnerId}`} className="font-medium text-brand-700 hover:underline">
              {info.partnerName}
            </Link>
          ) : (
            info.partnerName
          )
        ) : (
          <span className="text-ink-500">The consultancy itself</span>
        )}
      </p>
      {info.attributedAt && <p className="text-[12px] text-ink-400">Since {formatDate(info.attributedAt)}</p>}
    </Card>
  );
}

