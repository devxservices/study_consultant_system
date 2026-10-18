import type { DocumentStatus, DocumentType } from './documents';
import { STAGE_DEFINITIONS, type Stage } from './stages';

/** Minimal shape the checklist needs. Both the API and the UI pass their own rows in. */
export interface ChecklistDocument {
  /** A document type key: one of the built-in types or a consultancy's own. */
  type: DocumentType | (string & {});
  status: DocumentStatus;
}

export interface ChecklistItem {
  type: DocumentType | (string & {});
  /** Best status held for this type: verified > pending > rejected > missing. */
  status: DocumentStatus | 'missing';
  /** The type's name, when the API knows it (a consultancy's own types). */
  label?: string;
}

export interface StageProgress {
  /** The stage's category - one of the ten. */
  stage: Stage;
  /** The stage itself, in the application's workflow. */
  stageKey: string;
  items: ChecklistItem[];
  required: number;
  verified: number;
  /** True when every required document for the stage is verified. */
  satisfied: boolean;
  /** Human summary, e.g. "4 of 6 documents verified". */
  summary: string;
}

/** verified beats pending beats rejected - a client who re-uploaded is not "rejected". */
const STATUS_RANK: Record<DocumentStatus, number> = {
  verified: 3,
  under_review: 2,
  pending: 2,
  reupload_requested: 1,
  rejected: 1,
};

/**
 * Single source of truth for "is this stage done yet".
 * The auto-advancement engine and the client's checklist UI both call this,
 * so the number the client sees can never disagree with the server's decision.
 */
export function computeStageProgress(
  stage: Stage,
  documents: readonly ChecklistDocument[],
): StageProgress {
  return computeRequirementProgress(stage, stage, STAGE_DEFINITIONS[stage].requiredDocuments, documents);
}

/** The same rule for any stage of any workflow: its own list of required types. */
export function computeRequirementProgress(
  stage: Stage,
  stageKey: string,
  required: readonly string[],
  documents: readonly ChecklistDocument[],
): StageProgress {
  const best = new Map<string, DocumentStatus>();
  for (const doc of documents) {
    const existing = best.get(doc.type);
    if (!existing || STATUS_RANK[doc.status] > STATUS_RANK[existing]) {
      best.set(doc.type, doc.status);
    }
  }

  const items: ChecklistItem[] = required.map((type) => ({
    type,
    status: best.get(type) ?? 'missing',
  }));

  const verified = items.filter((i) => i.status === 'verified').length;

  return {
    stage,
    stageKey,
    items,
    required: required.length,
    verified,
    satisfied: required.length > 0 && verified === required.length,
    summary:
      required.length === 0
        ? 'No documents needed at this step'
        : `${verified} of ${required.length} documents verified`,
  };
}
