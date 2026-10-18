import type { ReactNode } from 'react';
import { PageStamp } from './page-stamp';
import Link from 'next/link';
import {
  CASE_STATUS_LABEL,
  DOCUMENT_META,
  DOCUMENT_STATUS_LABEL,
  DOCUMENT_STATUS_TONE,
  STAGE_DEFINITIONS,
  type CaseStatus,
  type CaseWorkflowView,
  type DocumentStatus,
  type Stage,
} from '@crm/shared';
import type {
  DocumentView,
  InvoiceSummaryView,
  MessageView,
  OfferType,
  TaskView,
} from '@crm/shared';
import { CaseDatesCard } from './case-dates';
import { TaskComposer } from './tasks/task-composer';
import { TaskList } from './tasks/task-list';
import { InvoiceTable } from './billing/invoice-table';
import { Panel, PanelLink } from './ui';
import { Card, EmptyState, Pill, cx } from './ui';
import { PipelineTracker, StalenessPill } from './stage';
import { StageControl } from './stage-control';
import { StageHistory, type StageHistoryEntry } from './stage-history';
import { DocumentList } from './document-review';
import { ChatThread } from './chat-thread';
import { relativeDays } from '@/lib/format';
import { WorkflowCard } from './workflows/workflow-card';

export interface ChecklistItem {
  type: string;
  status: DocumentStatus | 'missing';
  /** A consultancy's own document type comes with its name. */
  label?: string;
}

export interface CaseDetail {
  id: string;
  reference: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  consultantName: string | null;
  targetCountry: string;
  targetUniversity: string | null;
  studyLevel?: string | null;
  visaType?: string | null;
  targetProgram: string | null;
  intake: string | null;
  currentStage: Stage;
  currentStageKey?: string | null;
  currentStageName?: string | null;
  stageSlaDays?: number;
  workflow?: CaseWorkflowView | null;
  status: CaseStatus;
  notes: string | null;
  stageEnteredAt: string;
  lastActivityAt: string;
  createdAt: string;
  applicationDeadline: string | null;
  offerType: OfferType | null;
  offerConditions: string | null;
  offerDeadline: string | null;
  visaAppointmentAt: string | null;
  travelDate: string | null;
  institutionId?: string | null;
  institutionName?: string | null;
  tuitionFee?: number | null;
  tuitionCurrency?: string | null;
  scholarship?: number | null;
  courseStart?: string | null;
  daysInStage: number;
  isStuck: boolean;
  progress: {
    items: ChecklistItem[];
    required: number;
    verified: number;
    satisfied: boolean;
    summary: string;
  };
  history: StageHistoryEntry[];
}

const ITEM_TONE = { ...DOCUMENT_STATUS_TONE, missing: 'neutral' } as const;
const ITEM_LABEL = { ...DOCUMENT_STATUS_LABEL, missing: 'Not uploaded' } as const;

/**
 * The consultant's working view of one application. Everything needed to decide
 * "what happens to this case next" is on one screen: where it is, what is
 * missing, how long it has been sitting there, and the trail of how it got here.
 */
export function CaseView({
  detail,
  documents,
  chat,
  backHref,
  backLabel,
  clientHref,
  canEdit,
  canMove = canEdit,
  canInvoice = true,
  documentsHidden = false,
  chatHidden = false,
  base,
  tasks = null,
  invoices = null,
  assignees,
  canApprove = false,
  aside,
}: {
  /** More cards for the side column, after the dates (the institution and commission card). */
  aside?: ReactNode;
  /** May sign off gated stages and move through managers-only ones. */
  canApprove?: boolean;
  /** May move the stage and change the status. Defaults to canEdit. */
  canMove?: boolean;
  canInvoice?: boolean;
  /** The viewer may not see documents: the list is replaced by a note. */
  documentsHidden?: boolean;
  /** The viewer may not read conversations. */
  chatHidden?: boolean;
  detail: CaseDetail;
  documents: DocumentView[];
  base?: '/desk' | '/overview';
  /** Null when the plan has no tasks module. */
  tasks?: TaskView[] | null;
  /** Null when the plan has no billing module. */
  invoices?: InvoiceSummaryView[] | null;
  assignees?: { id: string; name: string }[];
  /** Null when the client has no login, so there is nobody to chat with. */
  chat: { me: { id: string; name: string }; messages: MessageView[] } | null;
  backHref: string;
  backLabel: string;
  clientHref: string;
  canEdit: boolean;
}) {
  const pendingCount = documents.filter((d) => d.status === 'pending').length;

  // Anything needing a decision floats to the top; settled documents sink.
  const RANK: Record<string, number> = { pending: 0, rejected: 1, verified: 2 };
  const sortedDocuments = [...documents].sort(
    (a, b) =>
      (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) ||
      new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime(),
  );

  return (
    <div>
      <PageStamp />
      <Link
        href={backHref}
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900"
      >
        <span aria-hidden>&larr;</span> {backLabel}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 pb-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[19px] font-semibold tracking-[-0.01em] text-ink-950">
              {detail.targetProgram ?? 'Programme not chosen'}
            </h1>
            <span className="tnum rounded border border-line bg-ink-50 px-1.5 py-0.5 font-mono text-[12px] text-ink-500">
              {detail.reference}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-ink-500">
            <Link href={clientHref} className="font-medium text-brand-700 hover:underline">
              {detail.clientName}
            </Link>
            {' · '}
            {detail.targetUniversity ?? 'University not chosen'} · {detail.targetCountry}
            {detail.intake ? ` · ${detail.intake}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {detail.isStuck && <Pill tone="bad" dot>Not moving</Pill>}
          <StalenessPill stage={detail.currentStage} days={detail.daysInStage} slaDays={detail.stageSlaDays} />
        </div>
      </div>

      {detail.isStuck && (
        <div className="mb-5 rounded-lg border border-bad-200 bg-bad-50 px-4 py-3">
          <p className="text-[14px] font-medium text-bad-700">
            This case has not moved in {detail.daysInStage} days.
          </p>
          <p className="mt-0.5 text-[13px] text-bad-700/85">
            {detail.currentStageName ?? STAGE_DEFINITIONS[detail.currentStage].label} normally clears within{' '}
            {detail.stageSlaDays ?? STAGE_DEFINITIONS[detail.currentStage].stuckAfterDays} days.
            {detail.progress.required > 0 && !detail.progress.satisfied
              ? ' The checklist below is still incomplete.'
              : ' Nothing is blocking it on our side.'}
          </p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-5">
          {/* Checklist for the current stage */}
          <section>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="text-[15.5px] font-medium text-ink-950">
                Checklist for this stage
              </h2>
              <span className="tnum text-[13px] text-ink-500">{detail.progress.summary}</span>
            </div>

            <Card>
              {detail.progress.required === 0 ? (
                <p className="px-4 py-5 text-[13px] text-ink-500">
                  No documents are required at this stage. Move the case on when the
                  university or embassy responds.
                </p>
              ) : (
                <>
                  <div className="h-1 w-full overflow-hidden bg-ink-100">
                    <div
                      className={cx(
                        'h-full transition-all',
                        detail.progress.satisfied ? 'bg-ok-500' : 'bg-brand-500',
                      )}
                      style={{
                        width: `${(detail.progress.verified / detail.progress.required) * 100}%`,
                      }}
                    />
                  </div>
                  <ul className="divide-y divide-line">
                    {detail.progress.items.map((item) => (
                      <li
                        key={item.type}
                        className="flex items-center justify-between gap-3 px-4 py-2.5"
                      >
                        <span className="min-w-0 truncate text-[14px] text-ink-800">
                          {item.label ?? DOCUMENT_META[item.type as keyof typeof DOCUMENT_META]?.label ?? item.type}
                        </span>
                        <Pill tone={ITEM_TONE[item.status]} dot={item.status !== 'missing'}>
                          {ITEM_LABEL[item.status]}
                        </Pill>
                      </li>
                    ))}
                  </ul>
                  {detail.progress.satisfied && (
                    <p className="border-t border-ok-200 bg-ok-50 px-4 py-2.5 text-[13px] text-ok-700">
                      Everything here is verified. The case advances on its own the moment the
                      last document is approved.
                    </p>
                  )}
                </>
              )}
            </Card>
          </section>

          {/* Documents - the review queue for this one case */}
          <section>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="text-[15.5px] font-medium text-ink-950">
                Documents ({documents.length})
              </h2>
              {pendingCount > 0 && (
                <span className="text-[13px] font-medium text-warn-700">
                  {pendingCount} waiting on you
                </span>
              )}
            </div>

            <Card className="overflow-hidden">
              {documentsHidden ? (
                <p className="px-4 py-5 text-[13px] text-ink-500">
                  You don’t have permission to see documents. Ask a manager if you need it.
                </p>
              ) : documents.length === 0 ? (
                <EmptyState
                  title="No documents yet"
                  description="Nothing has been uploaded for this application. The client can upload from their portal, or you can upload on their behalf."
                />
              ) : (
                <DocumentList documents={sortedDocuments} showClient={false} />
              )}
            </Card>
          </section>

          {base && tasks && (
            <Panel
              title="Follow-ups"
              subtitle={tasks.length ? `${tasks.length} open on this application` : 'Nothing open'}
              action={<PanelLink href={`${base}/tasks`}>All tasks</PanelLink>}
              bodyClassName=""
            >
              <div className="px-4 pb-3 sm:px-5">
                <TaskComposer caseId={detail.id} clientId={detail.clientId} assignees={assignees} compact />
              </div>
              <div className="border-t border-line">
                <TaskList tasks={tasks} hrefBase={base} showClient={false} showAssignee={Boolean(assignees)} empty="No open follow-ups." />
              </div>
            </Panel>
          )}

          {base && invoices && (
            <Panel
              title="Invoices"
              subtitle="Fees billed against this application"
              action={
                canInvoice ? (
                  <PanelLink href={`${base === '/overview' ? '/overview/finance' : '/desk/invoices'}/new?clientId=${detail.clientId}&caseId=${detail.id}`}>
                    New invoice
                  </PanelLink>
                ) : undefined
              }
              bodyClassName=""
            >
              <InvoiceTable
                invoices={invoices}
                hrefBase={base === '/overview' ? '/overview/finance/invoices' : '/desk/invoices'}
                showClient={false}
                empty="Nothing billed against this application."
              />
            </Panel>
          )}

          {/* Conversation with the client */}
          <section id="chat" className="scroll-mt-20">
            <h2 className="mb-2 text-[15.5px] font-medium text-ink-950">
              Conversation
            </h2>
            {chatHidden ? (
              <Card>
                <p className="px-4 py-5 text-[13px] text-ink-500">
                  You don’t have permission to read conversations. Ask a manager if you need it.
                </p>
              </Card>
            ) : chat ? (
              <ChatThread
                caseId={detail.id}
                me={chat.me}
                counterpartName={detail.clientName}
                initialMessages={chat.messages}
                heightClass="h-[500px]"
              />
            ) : (
              <Card>
                <p className="px-4 py-5 text-[13px] text-ink-500">
                  {detail.clientName} has not activated their portal login yet, so there is no
                  chat thread. Invite them from their client record to start one.
                </p>
              </Card>
            )}
          </section>

          {/* History */}
          <section>
            <h2 className="mb-2 text-[15.5px] font-medium text-ink-950">
              Stage history
            </h2>
            <Card className="overflow-hidden">
              <StageHistory entries={detail.history} />
            </Card>
          </section>

          {detail.notes && (
            <section>
              <h2 className="mb-2 text-[15.5px] font-medium text-ink-950">
                Case notes
              </h2>
              <Card className="p-4">
                <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-700">
                  {detail.notes}
                </p>
              </Card>
            </section>
          )}
        </div>

        <aside className="space-y-5">
          {canMove && detail.workflow ? (
            <StageControl
              caseId={detail.id}
              workflow={detail.workflow}
              targetCountry={detail.targetCountry}
              status={detail.status}
              checklistSatisfied={detail.progress.satisfied}
              checklistSummary={detail.progress.summary}
              canApprove={canApprove}
            />
          ) : (
            <Card className="p-4">
              <p className="text-[12px] font-medium uppercase tracking-wide text-ink-400">
                Current stage
              </p>
              <p className="mt-1 text-[17px] font-semibold text-ink-950">
                {detail.currentStageName ?? STAGE_DEFINITIONS[detail.currentStage].label}
              </p>
              <p className="mt-1 text-[13px] text-ink-500">{detail.progress.summary}</p>
              <div className="mt-3 border-t border-line pt-3">
                <Pill tone={detail.status === 'active' ? 'info' : 'neutral'}>
                  {CASE_STATUS_LABEL[detail.status]}
                </Pill>
              </div>
            </Card>
          )}

          {detail.workflow && (
            <WorkflowCard caseId={detail.id} workflow={detail.workflow} canChange={canMove} base={base ?? '/desk'} />
          )}

          <CaseDatesCard
            caseId={detail.id}
            canEdit={canEdit}
            dates={{
              studyLevel: detail.studyLevel,
              visaType: detail.visaType,
              intake: detail.intake,
              applicationDeadline: detail.applicationDeadline,
              offerType: detail.offerType,
              offerConditions: detail.offerConditions,
              offerDeadline: detail.offerDeadline,
              visaAppointmentAt: detail.visaAppointmentAt,
              travelDate: detail.travelDate,
            }}
          />

          {aside}

          <Card className="p-4">
            <h2 className="mb-3 text-[15.5px] font-medium text-ink-950">
              Progress
            </h2>
            <PipelineTracker
              currentStage={detail.currentStage}
              country={detail.targetCountry}
              enteredAt={detail.stageEnteredAt}
              history={historyDates(detail.history)}
              workflow={detail.workflow}
            />
          </Card>

          <Card className="p-4">
            <dl className="space-y-2.5 text-[13px]">
              <Row label="Consultant" value={detail.consultantName ?? 'Unassigned'} />
              <Row label="Opened" value={new Date(detail.createdAt).toLocaleDateString('en-GB')} />
              <Row label="Last activity" value={relativeDays(detail.lastActivityAt)} />
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}

/** Earliest entry date per stage, so the tracker can date completed steps. */
export function historyDates(entries: StageHistoryEntry[]): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  for (const e of [...entries].reverse()) {
    out[e.stageKey ?? e.stage] ??= e.enteredAt;
  }
  return out;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-ink-400">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-ink-800">{value}</dd>
    </div>
  );
}
