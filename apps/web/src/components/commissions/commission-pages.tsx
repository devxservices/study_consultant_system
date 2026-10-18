import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  CLAIM_STATUS_LABEL,
  COMMISSION_STAGE_LABEL,
  COMMISSION_STAGE_TONE,
  formatMoney,
  type AuthUser,
  type ClaimView,
  type CommissionSettingsView,
  type CommissionView,
  type CommissionsOverview,
  type FinanceSettingsView,
  type InstitutionReceiptView,
  type InstitutionSummaryView,
  type LedgerAccountView,
  type Paginated,
} from '@crm/shared';
import { ApiError, apiFetch, qs } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { Card, EmptyState, LinkButton, PageHeader, Panel, Pill, StatCard, cx, type Tone } from '../ui';
import { ReasonAction } from '../forms';
import { NoAccess } from '../no-access';
import { Pagination } from '../client-table';
import { IconAlert, IconCheck, IconClock, IconPercent, IconPlus, IconPrinter } from '../icons';
import { MoneyTable } from '../finance/workspace';
import { MyIncentivesPanel } from './incentives-panel';
import { commissionsBase, universitiesBase } from './institution-pages';
import {
  ClawbackForm,
  CommissionSettingsForm,
  ConfirmCommission,
  ManualCommissionForm,
  NewClaimForm,
  PayIncentive,
  ReceiptForm,
  SplitsEditor,
  SubmitClaim,
} from './commission-forms';

/* ------------------------------------------------------------------ */
/* Shared pieces                                                        */
/* ------------------------------------------------------------------ */

type CommissionsTab = 'overview' | 'list' | 'claims' | 'receipts' | 'settings';

function CommissionsTabs({ user, active }: { user: AuthUser; active: CommissionsTab }) {
  const base = commissionsBase(user);
  const tabs: { key: CommissionsTab; label: string; href: string }[] = [
    { key: 'overview', label: 'Overview', href: base },
    { key: 'list', label: 'Commissions', href: `${base}/list` },
    { key: 'claims', label: 'Claims', href: `${base}/claims` },
    { key: 'receipts', label: 'Receipts', href: `${base}/receipts` },
    { key: 'settings', label: 'Settings', href: `${base}/settings` },
  ];
  return (
    <nav className="-mb-px mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Commissions">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? 'page' : undefined}
          className={cx(
            'whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-[13.5px] font-medium',
            active === t.key ? 'border-brand-600 text-ink-950' : 'border-transparent text-ink-500 hover:text-ink-800',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

const CLAIM_TONE: Record<ClaimView['status'], Tone> = { draft: 'neutral', submitted: 'info', part_paid: 'info', disputed: 'bad', paid: 'ok', cancelled: 'neutral' };

function StagePill({ c }: { c: Pick<CommissionView, 'stage'> }) {
  return <Pill tone={COMMISSION_STAGE_TONE[c.stage]}>{COMMISSION_STAGE_LABEL[c.stage]}</Pill>;
}

function who(c: Pick<CommissionView, 'kind' | 'clientName' | 'number'>) {
  if (c.kind === 'bonus') return 'Volume bonus';
  if (c.kind === 'adjustment') return c.clientName ? `Adjustment · ${c.clientName}` : 'Adjustment';
  return c.clientName ?? c.number;
}

const institutionsList = () => apiFetch<InstitutionSummaryView[]>('/institutions');
const baseCurrency = () =>
  apiFetch<FinanceSettingsView>('/finance/settings')
    .then((s) => s.baseCurrency)
    .catch(() => 'GBP');
const moneyAccounts = () =>
  apiFetch<LedgerAccountView[]>('/finance/account-options')
    .then((all) => all.filter((a) => a.active && (a.subtype === 'cash' || a.subtype === 'bank' || a.subtype === 'clearing')).map((a) => ({ id: a.id, name: a.name })))
    .catch(() => [] as { id: string; name: string }[]);

async function load<T>(path: string): Promise<T> {
  try {
    return await apiFetch<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* The dashboard                                                        */
/* ------------------------------------------------------------------ */

/**
 * What the universities owe, what is on its way, and what to chase: the
 * totals per currency, the forecast by month, each institution's balance,
 * and the claims that are late.
 */
export async function CommissionsOverviewPage({ user }: { user: AuthUser }) {
  if (!can(user, 'commission.view')) return <NoAccess title="Commissions" permission="commission.view" />;
  const base = commissionsBase(user);
  const manage = can(user, 'commission.manage');
  const o = await apiFetch<CommissionsOverview>('/commissions/overview');
  // One row per month and currency: amounts in different currencies are never added together.
  const forecast = [...o.forecast].sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency));
  return (
    <>
      <PageHeader
        title="Commissions"
        subtitle="What universities pay you for the students you send them - from expected, to claimed, to received."
        actions={
          manage ? (
            <>
              <LinkButton href={`${base}/receipts/new`} variant="secondary">
                Record a receipt
              </LinkButton>
              <LinkButton href={`${base}/claims/new`}>
                <IconPlus size={16} />
                New claim
              </LinkButton>
            </>
          ) : undefined
        }
      />
      <CommissionsTabs user={user} active="overview" />

      {o.totals.length === 0 ? (
        <Card>
          <EmptyState
            title="No commission yet"
            description="Add your universities with their commission agreements. Commission is then expected automatically when a student reaches the agreed step."
            action={
              <LinkButton href={universitiesBase(user)} variant="secondary">
                Go to universities
              </LinkButton>
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {o.totals.length === 1 ? (
            o.totals.map((t) => (
              <div key={t.currency} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Expected" value={formatMoney(t.expected, t.currency)} tone="neutral" hint="Students on their way to enrolling" icon={<IconClock size={18} />} href={`${base}/list?view=expected`} />
                <StatCard label="To claim" value={formatMoney(t.toClaim, t.currency)} tone="warn" hint="Enrolled, not on a claim yet" icon={<IconPercent size={18} />} href={`${base}/list?view=to_claim`} />
                <StatCard label="Claimed, unpaid" value={formatMoney(t.claimed, t.currency)} tone="info" hint={t.overdueClaims ? `${t.overdueClaims} overdue` : 'None overdue'} icon={<IconAlert size={18} />} href={`${base}/list?view=claimed`} />
                <StatCard label="Received this year" value={formatMoney(t.receivedThisYear, t.currency)} tone="ok" hint={`${formatMoney(t.received, t.currency)} in all`} icon={<IconCheck size={18} />} href={`${base}/list?view=received`} />
              </div>
            ))
          ) : (
            // Universities pay in their own currencies; each is kept apart, never added up.
            <Panel title="Where it stands" subtitle="Per currency - each university pays in its own" bodyClassName="">
              <MoneyTable
                head={[
                  'Currency',
                  { label: 'Expected', right: true },
                  { label: 'To claim', right: true },
                  { label: 'Claimed, unpaid', right: true },
                  { label: 'Received this year', right: true },
                ]}
              >
                {o.totals.map((t) => (
                  <tr key={t.currency} className="border-t border-line">
                    <td className="px-4 py-2.5 font-medium text-ink-900">{t.currency}</td>
                    <td className="tnum px-4 py-2.5 text-right text-ink-500">
                      <Link href={`${base}/list?view=expected`} className="hover:text-brand-700">
                        {t.expected ? formatMoney(t.expected, t.currency) : '–'}
                      </Link>
                    </td>
                    <td className="tnum px-4 py-2.5 text-right font-medium text-warn-700">
                      <Link href={`${base}/list?view=to_claim`} className="hover:underline">
                        {t.toClaim ? formatMoney(t.toClaim, t.currency) : '–'}
                      </Link>
                    </td>
                    <td className="tnum px-4 py-2.5 text-right">
                      <Link href={`${base}/list?view=claimed`} className="hover:text-brand-700">
                        {t.claimed ? formatMoney(t.claimed, t.currency) : '–'}
                      </Link>
                      {t.overdueClaims > 0 && <span className="block text-[11.5px] text-bad-700">{t.overdueClaims} overdue</span>}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right text-ok-700">{t.receivedThisYear ? formatMoney(t.receivedThisYear, t.currency) : '–'}</td>
                  </tr>
                ))}
              </MoneyTable>
            </Panel>
          )}

          {(o.claimsOverdue.length > 0 || o.disputed > 0) && (
            <Panel title="To chase" subtitle="Claims past their due date, and commissions an institution questions">
              <div className="space-y-2">
                {o.claimsOverdue.map((c) => (
                  <Link key={c.id} href={`${base}/claims/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[13px] hover:bg-ink-50">
                    <span>
                      <span className="font-medium text-ink-900">{c.institutionName}</span>
                      <span className="text-ink-500">
                        {' '}
                        · {c.number} · {c.periodLabel} · due {formatDate(c.dueOn)}
                      </span>
                    </span>
                    <span className="tnum font-medium text-bad-700">{formatMoney(c.outstanding, c.currency)} outstanding</span>
                  </Link>
                ))}
                {o.disputed > 0 && (
                  <Link href={`${base}/list?view=problems`} className="block text-[13px] font-medium text-brand-700 hover:underline">
                    {o.disputed === 1 ? '1 commission is disputed' : `${o.disputed} commissions are disputed`} →
                  </Link>
                )}
              </div>
            </Panel>
          )}

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title="Forecast" subtitle="By the month it should be paid. Confirmed is earned; expected depends on the student enrolling." bodyClassName="">
              {forecast.length === 0 ? (
                <p className="px-5 pb-5 text-[13px] text-ink-400">Nothing outstanding.</p>
              ) : (
                <MoneyTable head={['Month', { label: 'Confirmed', right: true }, { label: 'Expected', right: true }]}>
                  {forecast.map((f, i) => (
                    <tr key={`${f.month}-${f.currency}`} className={cx('border-t border-line', i > 0 && forecast[i - 1]!.month === f.month && 'border-t-0')}>
                      <td className="px-4 py-2 text-ink-700">{i > 0 && forecast[i - 1]!.month === f.month ? '' : monthLabel(f.month)}</td>
                      <td className="tnum px-4 py-2 text-right font-medium">{f.confirmed ? formatMoney(f.confirmed, f.currency) : '–'}</td>
                      <td className="tnum px-4 py-2 text-right text-ink-500">{f.expected ? formatMoney(f.expected, f.currency) : '–'}</td>
                    </tr>
                  ))}
                </MoneyTable>
              )}
            </Panel>
            <Panel title="By institution" subtitle="Outstanding is confirmed and not yet received" bodyClassName="">
              {o.byInstitution.length === 0 ? (
                <p className="px-5 pb-5 text-[13px] text-ink-400">Nothing yet.</p>
              ) : (
                <MoneyTable head={['Institution', { label: 'Students', right: true }, { label: 'Outstanding', right: true }, { label: 'Received this year', right: true }]}>
                  {o.byInstitution.map((i) => (
                    <tr key={`${i.institutionId}-${i.currency}`} className="border-t border-line">
                      <td className="px-4 py-2">
                        <Link href={`${base}/list${qs({ view: 'all', institutionId: i.institutionId })}`} className="text-ink-900 hover:text-brand-700">
                          {i.name}
                        </Link>
                      </td>
                      <td className="tnum px-4 py-2 text-right text-ink-600">{i.students}</td>
                      <td className="tnum px-4 py-2 text-right font-medium">{i.outstanding ? formatMoney(i.outstanding, i.currency) : '–'}</td>
                      <td className="tnum px-4 py-2 text-right text-ok-700">{i.receivedThisYear ? formatMoney(i.receivedThisYear, i.currency) : '–'}</td>
                    </tr>
                  ))}
                </MoneyTable>
              )}
            </Panel>
          </div>
          {user.role === 'manager' && <MyIncentivesPanel commissionHref={(id) => `${base}/${id}`} />}
        </div>
      )}
    </>
  );
}

function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/* ------------------------------------------------------------------ */
/* The list                                                             */
/* ------------------------------------------------------------------ */

const VIEWS = [
  { key: 'all', label: 'All' },
  { key: 'expected', label: 'Expected' },
  { key: 'to_claim', label: 'To claim' },
  { key: 'claimed', label: 'Claimed' },
  { key: 'received', label: 'Received' },
  { key: 'problems', label: 'Problems' },
] as const;

export async function CommissionsListPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!can(user, 'commission.view')) return <NoAccess title="Commissions" permission="commission.view" />;
  const base = commissionsBase(user);
  const view = VIEWS.some((v) => v.key === query.view) ? query.view! : 'all';
  const pageNo = Math.max(1, Number(query.page) || 1);
  const filters = { institutionId: query.institutionId, caseId: query.caseId, q: query.q };
  const [list, institutions] = await Promise.all([
    apiFetch<Paginated<CommissionView>>(`/commissions${qs({ view, page: pageNo, ...filters })}`),
    institutionsList(),
  ]);
  const href = (x: Record<string, string | number | undefined>) => `${base}/list${qs({ view, ...filters, ...x })}`;
  const institution = institutions.find((i) => i.id === query.institutionId);
  return (
    <>
      <PageHeader
        title="Commissions"
        subtitle={institution ? `With ${institution.name}.` : query.caseId ? 'On one application.' : 'Every commission, one per student per year, plus bonuses.'}
        actions={
          can(user, 'commission.manage') ? (
            <LinkButton href={`${base}/new${qs({ institutionId: query.institutionId, caseId: query.caseId })}`} variant="secondary">
              <IconPlus size={16} />
              Add by hand
            </LinkButton>
          ) : undefined
        }
      />
      <CommissionsTabs user={user} active="list" />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={href({ view: v.key, page: undefined })}
            className={cx('rounded-full px-3 py-1 text-[12.5px] font-medium', view === v.key ? 'bg-ink-900 text-paper' : 'bg-ink-100 text-ink-600 hover:bg-ink-200')}
          >
            {v.label}
          </Link>
        ))}
        <form action={`${base}/list`} className="ml-auto flex flex-wrap items-center gap-2 text-[13px]">
          <input type="hidden" name="view" value={view} />
          {query.caseId && <input type="hidden" name="caseId" value={query.caseId} />}
          <select name="institutionId" defaultValue={query.institutionId ?? ''} className="h-9 rounded-lg border border-line-strong bg-paper px-2">
            <option value="">All institutions</option>
            {institutions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <input name="q" defaultValue={query.q} placeholder="Student or number" className="h-9 w-48 rounded-lg border border-line-strong bg-paper px-2.5" />
          <button className="h-9 rounded-lg bg-ink-900 px-3 font-medium text-paper">Filter</button>
        </form>
      </div>
      <Card className="overflow-hidden">
        {list.items.length === 0 ? (
          <EmptyState title="Nothing here" description={view === 'all' ? 'Commission appears when a student with an agreement reaches the agreed step, or when added by hand.' : 'No commission in this state.'} />
        ) : (
          <MoneyTable head={['Commission', 'Institution', 'Intake', 'Stage', 'Expected', { label: 'Amount', right: true }, { label: 'Received', right: true }]}>
            {list.items.map((c) => (
              <tr key={c.id} className="border-t border-line hover:bg-ink-50/60">
                <td className="px-4 py-2.5">
                  <Link href={`${base}/${c.id}`} className="font-medium text-ink-950 hover:text-brand-700">
                    {who(c)}
                  </Link>
                  <span className="block text-[11.5px] text-ink-400">
                    {c.number}
                    {c.caseReference ? ` · ${c.caseReference}` : ''}
                    {c.claimNumber ? ` · ${c.claimNumber}` : ''}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-ink-700">{c.institutionName}</td>
                <td className="px-4 py-2.5 text-ink-500">
                  {c.intake ?? '–'}
                  {c.kind === 'student' && c.yearNo > 1 ? ` · year ${c.yearNo}` : ''}
                </td>
                <td className="px-4 py-2.5">
                  <StagePill c={c} />
                </td>
                <td className="px-4 py-2.5 text-ink-500">{c.expectedOn ? formatDate(c.expectedOn) : '–'}</td>
                <td className="tnum px-4 py-2.5 text-right font-medium">{formatMoney(c.amount, c.currency)}</td>
                <td className="tnum px-4 py-2.5 text-right text-ok-700">{c.received ? formatMoney(c.received, c.currency) : '–'}</td>
              </tr>
            ))}
          </MoneyTable>
        )}
      </Card>
      <Pagination data={list} buildHref={(n) => href({ page: n })} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* One commission                                                       */
/* ------------------------------------------------------------------ */

export async function CommissionDetailPage({ user, id }: { user: AuthUser; id: string }) {
  if (!can(user, 'commission.view')) return <NoAccess title="Commissions" permission="commission.view" />;
  const base = commissionsBase(user);
  const manage = can(user, 'commission.manage');
  const payouts = manage && can(user, 'payout.manage');
  const c = await load<CommissionView>(`/commissions/${id}`);
  const [currency, staff, accounts] = await Promise.all([
    baseCurrency(),
    manage ? apiFetch<{ id: string; name: string }[]>('/commissions/staff-options').catch(() => []) : Promise.resolve([]),
    payouts && c.splits.some((s) => s.payable && !s.paidOn) ? moneyAccounts() : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const caseHref = c.caseId ? `${user.role === 'manager' ? '/overview' : '/desk'}/cases/${c.caseId}` : null;
  const open = c.status === 'confirmed' || c.status === 'claimed' || c.status === 'disputed';
  const facts: [string, React.ReactNode][] = [
    ['Institution', <Link key="i" href={`${universitiesBase(user)}/${c.institutionId}`} className="text-brand-700 hover:underline">{c.institutionName}</Link>],
    ['Student', c.clientName ? (caseHref ? <Link key="s" href={caseHref} className="text-brand-700 hover:underline">{c.clientName}{c.caseReference ? ` · ${c.caseReference}` : ''}</Link> : c.clientName) : '–'],
    ['Consultant', c.consultantName ?? '–'],
    ['Agreement', c.agreementTitle ? `${c.agreementTitle}${c.ruleName ? ` · ${c.ruleName}` : ''}` : 'Added by hand'],
    ['Intake', c.intake ? `${c.intake}${c.kind === 'student' ? ` · year ${c.yearNo}` : ''}` : '–'],
    ['Tuition', c.tuition ? formatMoney(c.tuition, c.currency) : '–'],
    ['Rate', c.rateBp ? `${c.rateBp / 100}%` : c.agreementId ? 'Fixed amount' : '–'],
    ['Can be claimed from', c.claimableOn ? formatDate(c.claimableOn) : '–'],
    ['Expected to be paid', c.expectedOn ? formatDate(c.expectedOn) : '–'],
    ['Retention until', c.retentionUntil ? formatDate(c.retentionUntil) : '–'],
    ['Claim', c.claimId ? <Link key="c" href={`${base}/claims/${c.claimId}`} className="text-brand-700 hover:underline">{c.claimNumber}</Link> : '–'],
    ['Confirmed', c.confirmedAt ? formatDate(c.confirmedAt) : '–'],
  ];
  return (
    <>
      <PageHeader
        title={`${who(c)} · ${formatMoney(c.amount, c.currency)}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StagePill c={c} />
            <span>
              {c.number} · received {formatMoney(c.received, c.currency)}
              {c.outstanding > 0 && open ? ` · ${formatMoney(c.outstanding, c.currency)} outstanding` : ''}
              {c.fxDifference ? ` · exchange difference ${formatMoney(c.fxDifference, currency)}` : ''}
            </span>
          </span>
        }
        breadcrumb={[{ href: base, label: 'Commissions' }, { href: `${base}/list`, label: 'All' }, { label: c.number }]}
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Panel title="Details">
            <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[11.5px] uppercase tracking-wide text-ink-400">{k}</dt>
                  <dd className="mt-0.5 text-ink-800">{v}</dd>
                </div>
              ))}
            </dl>
            {c.note && <p className="mt-4 rounded-lg bg-ink-50 px-3 py-2 text-[12.5px] text-ink-600">{c.note}</p>}
          </Panel>
          <Panel title="Who shares in it" subtitle="Staff incentives, owed once the institution has paid in full">
            {c.splits.length === 0 && !manage && <p className="text-[13px] text-ink-400">Nobody.</p>}
            {c.splits.length > 0 && (
              <div className="mb-4 divide-y divide-line rounded-lg border border-line">
                {c.splits.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
                    <span className="text-ink-900">
                      {s.userName} <span className="text-ink-400">· {s.shareBp / 100}%</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-3">
                      <span className="tnum font-medium">{formatMoney(s.paidAmount ?? s.amount, s.currency)}</span>
                      {s.paidOn ? (
                        <Pill tone="ok">Paid {formatDate(s.paidOn)}</Pill>
                      ) : s.payable ? (
                        payouts ? <PayIncentive splitId={s.id} accounts={accounts} /> : <Pill tone="warn">Due</Pill>
                      ) : (
                        <Pill tone="neutral">When received</Pill>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {manage && c.status !== 'cancelled' && <SplitsEditor id={c.id} splits={c.splits} staff={staff} />}
          </Panel>
        </div>
        {manage && (
          <Panel title="What happens next">
            <div className="space-y-4">
              {c.status === 'expected' && (
                <>
                  <ConfirmCommission id={c.id} currency={c.currency} baseCurrency={currency} amount={c.amount} />
                  <ReasonAction label="Not earned" confirmLabel="Cancel it" url={`/api/commissions/${c.id}/cancel`} explanation="The student did not enrol, or the visa was refused. Nothing was earned." variant="secondary" />
                </>
              )}
              {open && (
                <div className="flex flex-wrap gap-2">
                  {c.status === 'disputed' ? (
                    <ReasonAction label="Settled" confirmLabel="Mark it settled" url={`/api/commissions/${c.id}/resolve`} explanation="The institution accepted it. Say what was agreed." variant="secondary" />
                  ) : (
                    <ReasonAction label="Disputed" confirmLabel="Mark it disputed" url={`/api/commissions/${c.id}/dispute`} explanation="The institution questions this commission. Say what they said." variant="secondary" />
                  )}
                  {c.received === 0 && <ReasonAction label="Not earned" confirmLabel="Cancel it" url={`/api/commissions/${c.id}/cancel`} explanation="The student did not enrol after all. The booking is reversed." />}
                  {c.outstanding > 0 && <ReasonAction label="Write off" confirmLabel="Write it off" url={`/api/commissions/${c.id}/write-off`} explanation={`Give up on the ${formatMoney(c.outstanding, c.currency)} still owed. It is booked as a bad debt.`} />}
                  {c.received > 0 && <ClawbackForm id={c.id} currency={c.currency} received={c.received} />}
                </div>
              )}
              {c.status === 'confirmed' && !c.claimId && c.outstanding > 0 && (
                <LinkButton href={`${base}/claims/new${qs({ institutionId: c.institutionId })}`} variant="secondary" size="sm">
                  Put it on a claim
                </LinkButton>
              )}
              {!open && c.status !== 'expected' && <p className="text-[13px] text-ink-500">{COMMISSION_STAGE_LABEL[c.stage]}. Nothing more to do.</p>}
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}

export async function NewCommissionPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!can(user, 'commission.manage')) return <NoAccess title="Add a commission" permission="commission.manage" />;
  const base = commissionsBase(user);
  const institutions = await institutionsList();
  let caseLabel: string | null = null;
  let caseId: string | null = null;
  let institutionId = query.institutionId ?? null;
  if (query.caseId) {
    const k = await apiFetch<{ id: string; reference: string; clientName: string; institutionId: string | null }>(`/cases/${query.caseId}`).catch(() => null);
    if (k) {
      caseId = k.id;
      caseLabel = `${k.clientName} · ${k.reference}`;
      institutionId = k.institutionId ?? institutionId;
    }
  }
  return (
    <>
      <PageHeader title="Add a commission by hand" breadcrumb={[{ href: base, label: 'Commissions' }, { label: 'New' }]} />
      <Card className="p-5">
        <ManualCommissionForm institutions={institutions} caseId={caseId} caseLabel={caseLabel} institutionId={institutionId} detailBase={base} />
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Claims                                                               */
/* ------------------------------------------------------------------ */

const CLAIM_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Drafts' },
  { key: 'submitted', label: 'Sent' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'disputed', label: 'Disputed' },
  { key: 'paid', label: 'Paid' },
] as const;

export async function ClaimsPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!can(user, 'commission.view')) return <NoAccess title="Claims" permission="commission.view" />;
  const base = commissionsBase(user);
  const status = CLAIM_FILTERS.some((f) => f.key === query.status) ? query.status! : 'all';
  const claims = await apiFetch<ClaimView[]>(`/commissions/claims${qs({ status, institutionId: query.institutionId })}`);
  return (
    <>
      <PageHeader
        title="Claims"
        subtitle="The invoices you send universities for the commission they owe."
        actions={
          can(user, 'commission.manage') ? (
            <LinkButton href={`${base}/claims/new`}>
              <IconPlus size={16} />
              New claim
            </LinkButton>
          ) : undefined
        }
      />
      <CommissionsTabs user={user} active="claims" />
      <div className="mb-3 flex flex-wrap gap-2">
        {CLAIM_FILTERS.map((f) => (
          <Link key={f.key} href={`${base}/claims${qs({ status: f.key === 'all' ? undefined : f.key })}`} className={cx('rounded-full px-3 py-1 text-[12.5px] font-medium', status === f.key ? 'bg-ink-900 text-paper' : 'bg-ink-100 text-ink-600 hover:bg-ink-200')}>
            {f.label}
          </Link>
        ))}
      </div>
      <Card className="overflow-hidden">
        {claims.length === 0 ? (
          <EmptyState title="No claims" description="Make a claim from the confirmed commissions of one institution, download it, and send it to them." />
        ) : (
          <MoneyTable head={['Claim', 'Institution', 'Status', 'Sent', 'Due', { label: 'Total', right: true }, { label: 'Outstanding', right: true }]}>
            {claims.map((c) => (
              <tr key={c.id} className="border-t border-line hover:bg-ink-50/60">
                <td className="px-4 py-2.5">
                  <Link href={`${base}/claims/${c.id}`} className="font-medium text-ink-950 hover:text-brand-700">
                    {c.number}
                  </Link>
                  <span className="block text-[11.5px] text-ink-400">
                    {c.periodLabel} · {c.commissions.length} {c.commissions.length === 1 ? 'commission' : 'commissions'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-ink-700">{c.institutionName}</td>
                <td className="px-4 py-2.5">
                  <Pill tone={c.overdue ? 'bad' : CLAIM_TONE[c.status]}>{c.overdue ? 'Overdue' : CLAIM_STATUS_LABEL[c.status]}</Pill>
                </td>
                <td className="px-4 py-2.5 text-ink-500">{c.submittedOn ? formatDate(c.submittedOn) : '–'}</td>
                <td className={cx('px-4 py-2.5', c.overdue ? 'text-bad-700' : 'text-ink-500')}>{c.dueOn ? formatDate(c.dueOn) : '–'}</td>
                <td className="tnum px-4 py-2.5 text-right font-medium">{formatMoney(c.total, c.currency)}</td>
                <td className="tnum px-4 py-2.5 text-right">{c.outstanding ? formatMoney(c.outstanding, c.currency) : '–'}</td>
              </tr>
            ))}
          </MoneyTable>
        )}
      </Card>
    </>
  );
}

export async function NewClaimPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!can(user, 'commission.manage')) return <NoAccess title="New claim" permission="commission.manage" />;
  const base = commissionsBase(user);
  const institutionId = query.institutionId ?? '';
  const [institutions, list] = await Promise.all([
    institutionsList(),
    institutionId ? apiFetch<Paginated<CommissionView>>(`/commissions${qs({ view: 'to_claim', institutionId, pageSize: 100 })}`) : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader title="New claim" subtitle="Confirmed commissions not yet claimed, for one institution." breadcrumb={[{ href: `${base}/claims`, label: 'Claims' }, { label: 'New' }]} />
      <Card className="max-w-3xl p-5">
        <NewClaimForm commissions={list?.items ?? []} institutions={institutions} institutionId={institutionId} detailBase={`${base}/claims`} />
      </Card>
    </>
  );
}

export async function ClaimDetailPage({ user, id }: { user: AuthUser; id: string }) {
  if (!can(user, 'commission.view')) return <NoAccess title="Claims" permission="commission.view" />;
  const base = commissionsBase(user);
  const manage = can(user, 'commission.manage');
  const c = await load<ClaimView>(`/commissions/claims/${id}`);
  const sent = c.status === 'submitted' || c.status === 'part_paid' || c.status === 'disputed';
  return (
    <>
      <PageHeader
        title={`${c.number} · ${c.institutionName}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Pill tone={c.overdue ? 'bad' : CLAIM_TONE[c.status]}>{c.overdue ? 'Overdue' : CLAIM_STATUS_LABEL[c.status]}</Pill>
            <span>
              {c.periodLabel} · {formatMoney(c.total, c.currency)}
              {c.received ? ` · ${formatMoney(c.received, c.currency)} received` : ''}
              {c.submittedOn ? ` · sent ${formatDate(c.submittedOn)}` : ''}
              {c.dueOn ? ` · due ${formatDate(c.dueOn)}` : ''}
            </span>
          </span>
        }
        breadcrumb={[{ href: `${base}/claims`, label: 'Claims' }, { label: c.number }]}
        actions={
          <>
            <a href={`/api/commissions/claims/${c.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink-700 hover:bg-ink-50">
              <IconPrinter size={15} />
              PDF
            </a>
            {manage && sent && c.outstanding > 0 && (
              <LinkButton href={`${base}/receipts/new${qs({ institutionId: c.institutionId, claimId: c.id })}`}>Record payment</LinkButton>
            )}
          </>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="On the claim" bodyClassName="">
          <MoneyTable head={['Commission', 'Intake', 'Stage', { label: 'Tuition', right: true }, { label: 'Amount', right: true }, { label: 'Received', right: true }]}>
            {c.commissions.map((x) => (
              <tr key={x.id} className="border-t border-line">
                <td className="px-4 py-2.5">
                  <Link href={`${base}/${x.id}`} className="text-ink-900 hover:text-brand-700">
                    {who(x)}
                  </Link>
                  <span className="block text-[11.5px] text-ink-400">{x.number}</span>
                </td>
                <td className="px-4 py-2.5 text-ink-500">
                  {x.intake ?? '–'}
                  {x.kind === 'student' ? ` · year ${x.yearNo}` : ''}
                </td>
                <td className="px-4 py-2.5">
                  <StagePill c={x} />
                </td>
                <td className="tnum px-4 py-2.5 text-right text-ink-500">{x.tuition ? formatMoney(x.tuition, x.currency) : '–'}</td>
                <td className="tnum px-4 py-2.5 text-right font-medium">{formatMoney(x.amount, x.currency)}</td>
                <td className="tnum px-4 py-2.5 text-right text-ok-700">{x.received ? formatMoney(x.received, x.currency) : '–'}</td>
              </tr>
            ))}
          </MoneyTable>
          {c.notes && <p className="whitespace-pre-line border-t border-line px-5 py-3 text-[12.5px] text-ink-600">{c.notes}</p>}
        </Panel>
        {manage && (
          <Panel title="What happens next">
            <div className="space-y-3">
              {c.status === 'draft' && (
                <>
                  <p className="text-[12.5px] text-ink-500">Download the PDF, send it to {c.institutionName}, then mark it sent - the due date follows from the agreement’s payment terms.</p>
                  <SubmitClaim id={c.id} />
                </>
              )}
              {(c.status === 'submitted' || c.status === 'part_paid') && (
                <ReasonAction label="Disputed" confirmLabel="Mark it disputed" url={`/api/commissions/claims/${c.id}/dispute`} explanation="The institution questions the claim. Say what they said." variant="secondary" />
              )}
              {c.status === 'disputed' && <ReasonAction label="Settled" confirmLabel="Mark it settled" url={`/api/commissions/claims/${c.id}/resolve`} explanation="Say what was agreed." variant="secondary" />}
              {c.received === 0 && c.status !== 'cancelled' && (
                <ReasonAction label="Cancel the claim" confirmLabel="Cancel it" url={`/api/commissions/claims/${c.id}/cancel`} explanation="Its commissions go back to “to claim”." />
              )}
              {(c.status === 'paid' || c.status === 'cancelled') && <p className="text-[13px] text-ink-500">{CLAIM_STATUS_LABEL[c.status]}. Nothing more to do.</p>}
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Receipts                                                             */
/* ------------------------------------------------------------------ */

export async function ReceiptsPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!can(user, 'commission.view')) return <NoAccess title="Receipts" permission="commission.view" />;
  const base = commissionsBase(user);
  const manage = can(user, 'commission.manage');
  const receipts = await apiFetch<InstitutionReceiptView[]>(`/commissions/receipts${qs({ institutionId: query.institutionId })}`);
  return (
    <>
      <PageHeader
        title="Receipts from institutions"
        subtitle="Money universities sent, and the commissions each payment settled."
        actions={
          manage ? (
            <LinkButton href={`${base}/receipts/new`}>
              <IconPlus size={16} />
              Record a receipt
            </LinkButton>
          ) : undefined
        }
      />
      <CommissionsTabs user={user} active="receipts" />
      {receipts.length === 0 ? (
        <Card>
          <EmptyState title="Nothing received yet" description="When a university pays, record it here and match it to the commissions it covers." />
        </Card>
      ) : (
        <div className="space-y-3">
          {receipts.map((r) => (
            <Card key={r.id} className={cx('p-4', r.voided && 'opacity-60')}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[14.5px] font-medium text-ink-950">
                    {r.institutionName} · {formatMoney(r.amount, r.currency)}
                    {r.voided && <Pill tone="neutral" className="ml-2">Voided</Pill>}
                  </p>
                  <p className="text-[12.5px] text-ink-500">
                    {r.number} · {formatDate(r.receivedOn)} into {r.accountName}
                    {r.bankCharges ? ` · ${formatMoney(r.bankCharges, r.currency)} bank charges` : ''}
                    {r.reference ? ` · ref ${r.reference}` : ''}
                    {r.claimNumber ? ` · for ${r.claimNumber}` : ''}
                    {r.fxRate ? ` · rate ${r.fxRate}` : ''}
                  </p>
                  {r.voidReason && <p className="mt-1 text-[12px] text-bad-700">Voided: {r.voidReason}</p>}
                </div>
                <div className="text-right text-[12.5px]">
                  <p className="tnum text-ink-700">Matched {formatMoney(r.allocated, r.currency)}</p>
                  {r.unallocated !== 0 && <p className="tnum text-warn-700">{formatMoney(r.unallocated, r.currency)} unmatched</p>}
                </div>
              </div>
              {r.allocations.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.allocations.map((a) => (
                    <Link key={a.commissionId} href={`${base}/${a.commissionId}`} className={cx('rounded-md px-2 py-1 text-[12px] hover:underline', a.amount < 0 ? 'bg-bad-50 text-bad-700' : 'bg-ink-50 text-ink-700')}>
                      {a.clientName ?? a.commissionNumber}: {formatMoney(a.amount, r.currency)}
                    </Link>
                  ))}
                </div>
              )}
              {manage && !r.voided && (
                <div className="mt-3">
                  <ReasonAction label="Void" confirmLabel="Void the receipt" url={`/api/commissions/receipts/${r.id}/void`} explanation="It was recorded by mistake. The booking is reversed and its commissions are owed again." />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export async function NewReceiptPage({ user, query }: { user: AuthUser; query: Record<string, string | undefined> }) {
  if (!can(user, 'commission.manage')) return <NoAccess title="Record a receipt" permission="commission.manage" />;
  const base = commissionsBase(user);
  const institutionId = query.institutionId ?? '';
  const claimId = query.claimId ?? null;
  const [institutions, accounts, currency, open] = await Promise.all([institutionsList(), moneyAccounts(), baseCurrency(), institutionId ? openCommissions(institutionId, claimId) : Promise.resolve([])]);
  return (
    <>
      <PageHeader title="Record a receipt" subtitle="Money an institution sent you, matched to the commissions it pays." breadcrumb={[{ href: `${base}/receipts`, label: 'Receipts' }, { label: 'New' }]} />
      <Card className="max-w-4xl p-5">
        {accounts.length === 0 ? (
          <p className="text-[13px] text-ink-500">There is no bank or cash account to receive into. Ask whoever keeps the books to add one.</p>
        ) : (
          <ReceiptForm institutions={institutions} institutionId={institutionId} claimId={claimId} open={open} accounts={accounts} baseCurrency={currency} listBase={`${base}/receipts`} />
        )}
      </Card>
    </>
  );
}

/** What can be matched: outstanding commissions (the claim's first) and clawbacks to deduct. */
async function openCommissions(institutionId: string, claimId: string | null): Promise<CommissionView[]> {
  const views = ['to_claim', 'claimed', 'problems'] as const;
  const lists = await Promise.all(views.map((view) => apiFetch<Paginated<CommissionView>>(`/commissions${qs({ view, institutionId, pageSize: 100 })}`)));
  const all = lists.flatMap((l) => l.items).filter((c) => (c.status === 'clawed_back' ? true : c.status !== 'written_off' && c.outstanding > 0));
  const seen = new Set<string>();
  return all
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .sort((a, b) => Number(b.claimId === claimId && claimId !== null) - Number(a.claimId === claimId && claimId !== null));
}

/* ------------------------------------------------------------------ */
/* Settings                                                             */
/* ------------------------------------------------------------------ */

export async function CommissionSettingsPage({ user }: { user: AuthUser }) {
  if (!can(user, 'commission.view')) return <NoAccess title="Commission settings" permission="commission.view" />;
  const s = await apiFetch<CommissionSettingsView>('/commissions/settings');
  const manage = can(user, 'commission.manage');
  return (
    <>
      <PageHeader title="Commissions" subtitle="How commission is shared with staff, and how often late claims are chased." />
      <CommissionsTabs user={user} active="settings" />
      <Card className="p-5">
        {manage ? (
          <CommissionSettingsForm consultantSharePercent={s.consultantSharePercent} followUpDays={s.followUpDays} />
        ) : (
          <dl className="space-y-2 text-[13px]">
            <div>
              <dt className="text-ink-400">Consultant’s share</dt>
              <dd className="text-ink-800">{s.consultantSharePercent}%</dd>
            </div>
            <div>
              <dt className="text-ink-400">Chase late claims every</dt>
              <dd className="text-ink-800">{s.followUpDays} days</dd>
            </div>
          </dl>
        )}
      </Card>
    </>
  );
}
