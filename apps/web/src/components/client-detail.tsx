import Link from 'next/link';
import {
  STAGE_DEFINITIONS,
  formatMoney,
  passportWarning,
  type BillingTotals,
  type ClientProfile,
  type InvoiceSummaryView,
  type Stage,
  type TaskView,
  type AuthUser,
  type StudentChecklistView,
} from '@crm/shared';
import { can } from '@/lib/permissions';
import { Avatar, Card, EmptyState, LinkButton, PageHeader, Panel, PanelLink, Pill } from './ui';
import { PipelineTracker, StageChip, StalenessPill } from './stage';
import { ClientProfileCard } from './client-profile';
import { PortalAccessCard } from './portal-access';
import { TaskComposer } from './tasks/task-composer';
import { TaskList } from './tasks/task-list';
import { InvoiceTable } from './billing/invoice-table';
import { formatDate, relativeDays } from '@/lib/format';
import { IconPlus } from './icons';

export interface CaseRow {
  id: string;
  reference: string;
  targetCountry: string;
  targetUniversity: string | null;
  targetProgram: string | null;
  intake: string | null;
  currentStage: Stage;
  stageName?: string | null;
  stageSlaDays?: number | null;
  status: string;
  stageEnteredAt: string;
  lastActivityAt: string;
}

export interface ClientDetail {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  city: string | null;
  notes: string | null;
  archived: boolean;
  programme?: 'study_abroad' | 'course_only';
  userId: string | null;
  hasLogin: boolean;
  loginHasTwoStep?: boolean;
  createdAt: string;
  profile: ClientProfile;
  consultant: { id: string; name: string; email: string } | null;
  cases: CaseRow[];
}

const daysIn = (iso: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

/**
 * One client, everything about them on one screen: their applications, the
 * follow-ups open on them, what they owe, and the profile a consultant advises
 * from. Shared by the consultant's desk and the manager's drill-down; only the
 * paths and the actions differ.
 */
export function ClientDetailView({
  client,
  base,
  tasks,
  invoices,
  balance,
  assignees,
  actions,
  viewer,
  checklist = null,
  aside,
}: {
  /** More cards for the side column (who brought the student). */
  aside?: React.ReactNode;
  /** Who is looking - decides which actions are offered. */
  viewer: Pick<AuthUser, 'role' | 'permissions'>;
  client: ClientDetail;
  base: '/desk' | '/overview';
  /** Null when the plan has no tasks module. */
  tasks: TaskView[] | null;
  /** Null when the plan has no billing module. */
  invoices: InvoiceSummaryView[] | null;
  balance: BillingTotals | null;
  /** Staff a manager can hand a task to. */
  assignees?: { id: string; name: string }[];
  actions?: React.ReactNode;
  /** Document checklist completion; null when they may not see documents. */
  checklist?: StudentChecklistView | null;
}) {
  const warn = passportWarning(client.profile.passportExpiry);
  const allowed = {
    invoice: can(viewer, 'billing.invoice'),
    edit: can(viewer, 'client.edit'),
    openCase: can(viewer, 'case.create'),
    portal: can(viewer, 'client.portal_access'),
  };
  const invoiceBase = base === '/overview' ? '/overview/finance' : '/desk/invoices';

  return (
    <div>
      <Link
        href={`${base}/clients`}
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900"
      >
        <span aria-hidden>&larr;</span> Back to clients
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 pb-5">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={client.fullName} size={48} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[21px] font-semibold tracking-[-0.01em] text-ink-950">{client.fullName}</h1>
              {client.archived && <Pill tone="neutral">Archived</Pill>}
              {client.programme === 'course_only' && <Pill tone="info">Course only</Pill>}
              {!client.hasLogin && <Pill tone="warn">No portal login</Pill>}
              {warn && (
                <Pill tone={warn === 'expired' ? 'bad' : 'warn'} dot>
                  {warn === 'expired' ? 'Passport expired' : 'Passport expires soon'}
                </Pill>
              )}
            </div>
            <p className="mt-0.5 truncate text-[13px] text-ink-500">
              {client.city ? `${client.city} · ` : ''}
              <a href={`tel:${client.phone}`} className="hover:text-ink-800">
                {client.phone}
              </a>
              {' · '}
              <a href={`mailto:${client.email}`} className="hover:text-ink-800">
                {client.email}
              </a>
              {client.consultant ? ` · with ${client.consultant.name}` : ' · unassigned'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {invoices && allowed.invoice && (
            <LinkButton href={`${invoiceBase}/new?clientId=${client.id}`} variant="secondary">
              New invoice
            </LinkButton>
          )}
          {allowed.edit && (
            <LinkButton href={`${base}/clients/${client.id}/edit`} variant="secondary">
              Edit details
            </LinkButton>
          )}
          {allowed.openCase && (
            <LinkButton href={`${base}/clients/${client.id}/applications/new`}>
              <IconPlus size={16} />
              Application
            </LinkButton>
          )}
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-5">
          <Panel
            title={`Applications (${client.cases.length})`}
            subtitle="Each country or university is its own case"
            bodyClassName="px-4 pb-4 sm:px-5"
          >
            {client.cases.length === 0 ? (
              <EmptyState
                compact
                title="No application yet"
                description={
                  client.programme === 'course_only'
                    ? 'On a course only, so not in the study-abroad pipeline. Opening an application moves them to study abroad.'
                    : 'Open their first application to start tracking it through the pipeline.'
                }
                action={
                  allowed.openCase ? (
                    <LinkButton href={`${base}/clients/${client.id}/applications/new`}>Open an application</LinkButton>
                  ) : undefined
                }
              />
            ) : (
              <div className="grid gap-3 xl:grid-cols-2">
                {client.cases.map((c) => (
                  <Link
                    key={c.id}
                    href={`${base}/cases/${c.id}`}
                    className="block rounded-xl border border-line bg-paper p-4 transition-colors hover:border-brand-200 hover:bg-brand-50/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-medium text-ink-950">
                          {c.targetProgram ?? 'Programme not chosen'}
                        </p>
                        <p className="mt-0.5 truncate text-[13px] text-ink-500">
                          {c.targetUniversity ?? 'University not chosen'} · {c.targetCountry}
                          {c.intake ? ` · ${c.intake}` : ''}
                        </p>
                      </div>
                      <span className="tnum shrink-0 rounded border border-line bg-ink-50 px-1.5 py-0.5 font-mono text-[12px] text-ink-500">
                        {c.reference}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                      <StageChip stage={c.currentStage} country={c.targetCountry} name={c.stageName} />
                      <StalenessPill stage={c.currentStage} days={daysIn(c.stageEnteredAt)} slaDays={c.stageSlaDays} />
                      <span className="text-[12px] text-ink-400">Active {relativeDays(c.lastActivityAt)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          {checklist && (
            <Panel
              title="Documents"
              subtitle={`Checklist ${checklist.overall}% complete`}
              action={<PanelLink href={`${base}/documents?clientId=${client.id}`}>Open their drive</PanelLink>}
            >
              <ul className="space-y-2.5">
                {checklist.applications.map((a) => (
                  <li key={a.caseId ?? 'general'}>
                    <div className="flex justify-between gap-3 text-[12.5px]">
                      <span className="truncate text-ink-700">
                        {a.reference ? `${a.reference}${a.targetCountry ? ` · ${a.targetCountry}` : ''}` : a.setName}
                      </span>
                      <span className="tnum shrink-0 font-medium text-ink-900">
                        {a.approved}/{a.required} · {a.percent}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                      <div
                        className={a.percent === 100 ? 'h-full origin-left rounded-full bg-ok-500' : 'h-full origin-left rounded-full bg-brand-500'}
                        style={{ transform: `scaleX(${a.percent / 100})` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {tasks && (
            <Panel
              title="Follow-ups"
              subtitle={tasks.length ? `${tasks.length} open` : 'Nothing open'}
              action={<PanelLink href={`${base}/tasks`}>All tasks</PanelLink>}
              bodyClassName=""
            >
              <div className="px-4 pb-3 sm:px-5">
                <TaskComposer clientId={client.id} assignees={assignees} compact />
              </div>
              <div className="border-t border-line">
                <TaskList
                  tasks={tasks}
                  hrefBase={base}
                  showClient={false}
                  showAssignee={Boolean(assignees)}
                  empty="No open follow-ups for this client."
                />
              </div>
            </Panel>
          )}

          {invoices && (
            <Panel
              title="Invoices"
              subtitle={
                balance
                  ? `${formatMoney(balance.outstanding, balance.currency)} outstanding of ${formatMoney(balance.invoiced, balance.currency)}`
                  : 'Nothing billed yet'
              }
              action={
                <span className="flex flex-wrap gap-1.5">
                  {invoices.length > 0 && (
                    <PanelLink href={`${base === '/overview' ? '/overview/finance/statement' : '/desk/invoices/statement'}/${client.id}`}>Statement</PanelLink>
                  )}
                  {allowed.invoice && (
                    <PanelLink href={`${base === '/overview' ? '/overview/finance/quotes' : '/desk/invoices/quotes'}/new?clientId=${client.id}`}>New quote</PanelLink>
                  )}
                  {allowed.invoice && <PanelLink href={`${invoiceBase}/new?clientId=${client.id}`}>New invoice</PanelLink>}
                </span>
              }
              bodyClassName=""
            >
              <InvoiceTable
                invoices={invoices}
                hrefBase={base === '/overview' ? '/overview/finance/invoices' : '/desk/invoices'}
                showClient={false}
                empty="No invoices for this client yet."
              />
            </Panel>
          )}

          {client.notes && (
            <Panel title="Internal notes" subtitle="Not visible to the client">
              <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-700">{client.notes}</p>
            </Panel>
          )}
        </div>

        <aside className="space-y-5">
          {client.cases[0] && (
            <Card className="p-4">
              <h2 className="mb-3 text-[15.5px] font-medium text-ink-950">Progress</h2>
              <PipelineTracker
                currentStage={client.cases[0].currentStage}
                country={client.cases[0].targetCountry}
                enteredAt={client.cases[0].stageEnteredAt}
              />
            </Card>
          )}

          <ClientProfileCard profile={client.profile} />

          {aside}

          <PortalAccessCard
            clientId={client.id}
            name={client.fullName}
            email={client.email}
            hasLogin={client.hasLogin}
            everHadLogin={Boolean(client.userId)}
            twoStep={client.loginHasTwoStep}
            canManage={allowed.portal}
          />

          <Card className="p-4">
            <h2 className="mb-3 text-[15.5px] font-medium text-ink-950">Record</h2>
            <dl className="space-y-2.5 text-[13px]">
              <Row label="Consultant" value={client.consultant?.name ?? 'Unassigned'} />
              <Row label="Client since" value={formatDate(client.createdAt)} />
              {client.cases[0] && (
                <Row label="Current step" value={client.cases[0].stageName ?? STAGE_DEFINITIONS[client.cases[0].currentStage].label} />
              )}
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-ink-400">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-ink-800">{value}</dd>
    </div>
  );
}

export { PageHeader };
