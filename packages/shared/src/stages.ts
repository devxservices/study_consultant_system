import type { DocumentType } from './documents';

/**
 * The study-visa pipeline, in order. Values are stable DB identifiers.
 */
export const STAGES = [
  'inquiry',
  'shortlisting',
  'documents_collection',
  'application_submitted',
  'offer_letter',
  'fee_payment',
  'visa_filed',
  'visa_interview',
  'visa_decision',
  'closed',
] as const;
export type Stage = (typeof STAGES)[number];

export interface StageDefinition {
  key: Stage;
  /** Shown to consultants and managers. */
  label: string;
  /** Shown to the client - written so a nervous applicant understands it at a glance. */
  clientLabel: string;
  /** One line of plain English explaining what is happening right now. */
  clientDescription: string;
  /** Document types that must ALL be verified before the case may leave this stage. */
  requiredDocuments: readonly DocumentType[];
  /**
   * Stage does not apply to every case (e.g. most UK/Canada routes hold no interview).
   * Conditional stages are skipped automatically when not applicable.
   */
  conditional: boolean;
  /** Days without movement after which a manager should be alerted. */
  stuckAfterDays: number;
}

export const STAGE_DEFINITIONS: Record<Stage, StageDefinition> = {
  inquiry: {
    key: 'inquiry',
    label: 'Inquiry / Consultation',
    clientLabel: 'Getting started',
    clientDescription: 'We are learning about your goals and budget to advise you properly.',
    requiredDocuments: [],
    conditional: false,
    stuckAfterDays: 7,
  },
  shortlisting: {
    key: 'shortlisting',
    label: 'University Shortlisting',
    clientLabel: 'Choosing your universities',
    clientDescription: 'Your consultant is picking courses and universities that fit your profile.',
    requiredDocuments: [],
    conditional: false,
    stuckAfterDays: 10,
  },
  documents_collection: {
    key: 'documents_collection',
    label: 'Documents Collection',
    clientLabel: 'Collecting your documents',
    clientDescription: 'Upload each document below. We check every one and tell you if anything needs fixing.',
    requiredDocuments: [
      'passport',
      'cnic',
      'transcript',
      'language_test',
      'bank_statement',
      'sop',
    ],
    conditional: false,
    stuckAfterDays: 14,
  },
  application_submitted: {
    key: 'application_submitted',
    label: 'Application Submitted',
    clientLabel: 'Application sent to the university',
    clientDescription: 'Your application is with the university. Waiting on their decision.',
    requiredDocuments: [],
    conditional: false,
    stuckAfterDays: 30,
  },
  offer_letter: {
    key: 'offer_letter',
    label: 'Offer Letter Received',
    clientLabel: 'Offer letter received',
    clientDescription: 'The university has offered you a place. Congratulations.',
    requiredDocuments: ['offer_letter'],
    conditional: false,
    stuckAfterDays: 14,
  },
  fee_payment: {
    key: 'fee_payment',
    label: 'Fee Payment / I-20 or CAS Issued',
    clientLabel: 'Paying the deposit',
    clientDescription: 'Pay the tuition deposit so the university can issue your enrolment document.',
    requiredDocuments: ['fee_receipt', 'i20_cas'],
    conditional: false,
    stuckAfterDays: 21,
  },
  visa_filed: {
    key: 'visa_filed',
    label: 'Visa Application Filed',
    clientLabel: 'Visa application filed',
    clientDescription: 'Your visa application has been submitted to the embassy.',
    requiredDocuments: ['visa_form'],
    conditional: false,
    stuckAfterDays: 21,
  },
  visa_interview: {
    key: 'visa_interview',
    label: 'Visa Interview',
    clientLabel: 'Visa interview',
    clientDescription: 'Attend your embassy interview. Your consultant will prepare you beforehand.',
    requiredDocuments: [],
    conditional: true,
    stuckAfterDays: 21,
  },
  visa_decision: {
    key: 'visa_decision',
    label: 'Visa Decision',
    clientLabel: 'Visa decision',
    clientDescription: 'The embassy is deciding on your visa.',
    requiredDocuments: [],
    conditional: false,
    stuckAfterDays: 30,
  },
  closed: {
    key: 'closed',
    label: 'Case Closed / Departure',
    clientLabel: 'All done',
    clientDescription: 'Your case is complete. We wish you the very best.',
    requiredDocuments: [],
    conditional: false,
    stuckAfterDays: 3650,
  },
};

export const STAGE_ORDER: readonly Stage[] = STAGES;

export function stageIndex(stage: Stage): number {
  return STAGE_ORDER.indexOf(stage);
}

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value);
}

/**
 * Countries whose student visa route normally includes an in-person interview.
 * Anything not listed here skips the visa_interview stage automatically.
 */
const INTERVIEW_COUNTRIES = new Set(['United States', 'USA', 'US']);

export function stageAppliesToCase(stage: Stage, targetCountry: string | null | undefined): boolean {
  if (!STAGE_DEFINITIONS[stage].conditional) return true;
  if (stage === 'visa_interview') {
    return INTERVIEW_COUNTRIES.has((targetCountry ?? '').trim());
  }
  return true;
}

/**
 * The next stage a case should move into, skipping any conditional stage that
 * does not apply to this case. Returns null when already at the end.
 */
export function nextApplicableStage(
  current: Stage,
  targetCountry: string | null | undefined,
): Stage | null {
  for (let i = stageIndex(current) + 1; i < STAGE_ORDER.length; i++) {
    const candidate = STAGE_ORDER[i]!;
    if (stageAppliesToCase(candidate, targetCountry)) return candidate;
  }
  return null;
}

/** The full ordered list of stages this particular case will pass through. */
export function applicableStages(targetCountry: string | null | undefined): Stage[] {
  return STAGE_ORDER.filter((s) => stageAppliesToCase(s, targetCountry));
}

export const CASE_STATUSES = ['active', 'on_hold', 'approved', 'rejected', 'withdrawn'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  active: 'Active',
  on_hold: 'On hold',
  approved: 'Visa approved',
  rejected: 'Visa refused',
  withdrawn: 'Withdrawn',
};
