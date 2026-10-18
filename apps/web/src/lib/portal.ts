import { cache } from 'react';
import { STAGE_DEFINITIONS, type CaseWorkflowView, type DocumentStatus, type Stage } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { requireRole } from '@/lib/session';

/**
 * The client portal's shared data, resolved once per request.
 *
 * Every portal tab needs the same starting point - who is signed in, their
 * client record, and the case that record is about - so it lives here behind
 * `cache()`, which dedupes the fetch across the layout and whichever page
 * rendered inside it within a single request.
 */

export interface PortalCaseSummary {
  id: string;
  currentStage: Stage;
  stageName?: string | null;
  targetCountry: string;
}

export interface PortalClient {
  id: string;
  fullName: string;
  consultant: { id: string; name: string; email: string } | null;
  cases: PortalCaseSummary[];
}

export interface StageHistoryEntry {
  id: string;
  stage: Stage;
  stageKey?: string | null;
  stageName?: string | null;
  enteredAt: string;
  completedAt: string | null;
  method: 'auto' | 'manual' | 'initial';
  changedByName: string | null;
  note: string | null;
}

export interface PortalCaseDetail {
  id: string;
  reference: string;
  targetCountry: string;
  targetUniversity: string | null;
  targetProgram: string | null;
  intake: string | null;
  currentStage: Stage;
  status: string;
  stageEnteredAt: string;
  applicationDeadline: string | null;
  offerType: 'conditional' | 'unconditional' | null;
  offerConditions: string | null;
  offerDeadline: string | null;
  visaAppointmentAt: string | null;
  travelDate: string | null;
  progress: {
    items: { type: string; status: DocumentStatus | 'missing'; label?: string }[];
    required: number;
    verified: number;
    satisfied: boolean;
    summary: string;
  };
  history: StageHistoryEntry[];
  workflow?: CaseWorkflowView | null;
}

export const getPortalClient = cache(async () => {
  const user = await requireRole('client');
  // Fetched by id from the session rather than by listing: an archived client
  // who signs in is still entitled to read their own file, and the list
  // endpoint hides archived records.
  const client = user.clientId
    ? await apiFetch<PortalClient>(`/clients/${user.clientId}`).catch(() => null)
    : null;
  return { user, client, firstCase: client?.cases[0] ?? null };
});

export const getPortalCase = cache(async (caseId: string) =>
  apiFetch<PortalCaseDetail>(`/cases/${caseId}`),
);

/** Earliest entry per stage, so completed steps can show a date. */
export function historyDates(entries: StageHistoryEntry[]): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  for (const e of [...entries].reverse()) out[e.stageKey ?? e.stage] ??= e.enteredAt;
  return out;
}

/** Where the application is, in the words its workflow wrote for the student. */
export function currentStep(detail: PortalCaseDetail): { clientLabel: string; clientDescription: string } {
  const own = detail.workflow?.stages.find((s) => s.key === detail.workflow?.currentStageKey);
  return own ?? STAGE_DEFINITIONS[detail.currentStage];
}
