import { z } from 'zod';
import { STAGES, STAGE_DEFINITIONS, STAGE_ORDER, type Stage } from './stages';
import { CURRENCIES } from './billing';
import { TASK_PRIORITIES } from './dto/tasks';
import { uuidSchema } from './dto/common';
import type { TransitionCheck } from './transitions';

/*
 * Countries, workflows and automations.
 *
 * A workflow is the pipeline one kind of application goes through - "Canada
 * study permit", "UK Student visa, postgraduate". Each consultancy starts
 * with a "Standard" workflow that is exactly the ten stages the product has
 * always had, and every existing application runs on it.
 *
 * Every stage of every workflow belongs to one of those ten stages as its
 * *category*. A consultancy may call a step "GIC and medicals" and give it
 * its own documents, tasks and messages; dashboards, funnels and the
 * stuck-case alert still read it as "Fee payment", so numbers stay
 * comparable across countries and nothing built on the ten stages breaks.
 *
 * A published version never changes. Editing makes a draft; publishing the
 * draft makes the next version, and applications move to it only when
 * someone chooses to.
 */

/* ------------------------------------------------------------------ */
/* Small shared pieces                                                  */
/* ------------------------------------------------------------------ */

const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'A three-letter currency code, e.g. GBP');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/** The usual ways people write the big destinations, folded to one name. */
const COUNTRY_ALIASES: Record<string, string> = {
  us: 'united states',
  usa: 'united states',
  'u.s.': 'united states',
  'u.s.a.': 'united states',
  america: 'united states',
  'united states of america': 'united states',
  uk: 'united kingdom',
  'u.k.': 'united kingdom',
  britain: 'united kingdom',
  'great britain': 'united kingdom',
  england: 'united kingdom',
  scotland: 'united kingdom',
  wales: 'united kingdom',
  uae: 'united arab emirates',
  nz: 'new zealand',
};

/** Lower-case, trimmed, aliases folded: for comparing, never for display. */
export function normaliseCountry(value: string | null | undefined): string {
  const v = (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return COUNTRY_ALIASES[v] ?? v;
}

/** 🇬🇧 from "GB". */
export function countryFlag(code: string | null | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/* ------------------------------------------------------------------ */
/* Countries                                                            */
/* ------------------------------------------------------------------ */

export const countryIntakeSchema = z.object({
  name: z.string().trim().min(2, 'Name the intake, e.g. September').max(40),
  month: z.coerce.number().int().min(1).max(12),
  /** Free text, because it varies by university: "Most close 30 June". */
  applicationDeadline: optionalText(120),
});
export type CountryIntake = z.output<typeof countryIntakeSchema>;

export const countryFeeSchema = z.object({
  label: z.string().trim().min(2, 'What is the fee for?').max(80),
  amount: z.coerce.number().min(0).max(100_000_000),
  currency: currencyCodeSchema,
  notes: optionalText(200),
});
export type CountryFee = z.output<typeof countryFeeSchema>;

export const languageRequirementSchema = z.object({
  /** IELTS, PTE, TOEFL iBT, Duolingo, OET, Goethe B1... */
  test: z.string().trim().min(2, 'Which test?').max(40),
  /** A string so "6.5", "79" and "B2" all fit. */
  overall: z.string().trim().min(1, 'Overall score').max(20),
  minimumBand: optionalText(20),
  notes: optionalText(200),
});
export type LanguageRequirement = z.output<typeof languageRequirementSchema>;

export const proofOfFundsSchema = z.object({
  amount: z.coerce.number().min(0).max(100_000_000).nullable().optional(),
  currency: currencyCodeSchema.optional(),
  /** "First-year tuition + 9 months of living costs" */
  basis: optionalText(200),
  /** UK: 28 consecutive days. */
  holdingDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  notes: optionalText(300),
});
export type ProofOfFunds = z.output<typeof proofOfFundsSchema>;

export const countrySchema = z.object({
  name: z.string().trim().min(2, 'Country name').max(60),
  /** ISO 3166-1 alpha-2, for the flag and for exports. */
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Two letters, e.g. GB'),
  active: z.boolean().default(true),
  currency: currencyCodeSchema,
  intakes: z.array(countryIntakeSchema).max(12).default([]),
  fees: z.array(countryFeeSchema).max(20).default([]),
  proofOfFunds: proofOfFundsSchema.nullable().default(null),
  languageRequirements: z.array(languageRequirementSchema).max(12).default([]),
  /** Routes a student may apply under: "Student visa", "Study permit"... */
  visaTypes: z.array(z.string().trim().min(2).max(60)).max(12).default([]),
  visaProcessingDays: z.coerce.number().int().min(0).max(365).nullable().default(null),
  workRights: optionalText(300),
  postStudyWork: optionalText(300),
  notes: optionalText(4000),
});
export type CountryInput = z.input<typeof countrySchema>;
export type CountryData = z.output<typeof countrySchema>;

export interface CountryView extends CountryData {
  id: string;
  flag: string;
  /** Applications to this country, all time and still open. */
  caseCount: number;
  activeCaseCount: number;
  /** Workflows aimed at this country. */
  workflowCount: number;
  /** Document checklists aimed at this country. */
  checklistCount: number;
  updatedAt: string;
}

export const countriesQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type CountriesQuery = z.output<typeof countriesQuerySchema>;

/* ------------------------------------------------------------------ */
/* Conditions                                                           */
/* ------------------------------------------------------------------ */

/**
 * What a condition can look at. The case fields decide whether a stage
 * applies to an application; the event fields are there for automations.
 */
export const CONDITION_FIELDS = [
  'targetCountry',
  'studyLevel',
  'visaType',
  'intake',
  'targetUniversity',
  'leadSource',
  'status',
  'stageKey',
  'stageCategory',
  'documentType',
  'daysInStage',
] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const CONDITION_FIELD_LABEL: Record<ConditionField, string> = {
  targetCountry: 'Destination country',
  studyLevel: 'Study level',
  visaType: 'Visa type',
  intake: 'Intake',
  targetUniversity: 'University',
  leadSource: 'Lead source',
  status: 'Application status',
  stageKey: 'Stage',
  stageCategory: 'Stage category',
  documentType: 'Document type',
  daysInStage: 'Days in stage',
};

/** Fields a stage's "applies when" may use - the facts of the application. */
export const STAGE_CONDITION_FIELDS: readonly ConditionField[] = [
  'targetCountry',
  'studyLevel',
  'visaType',
  'intake',
  'targetUniversity',
  'leadSource',
];

export const CONDITION_OPS = ['is', 'is_not', 'in', 'not_in', 'contains', 'is_set', 'is_empty', 'gte', 'lte'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export const CONDITION_OP_LABEL: Record<ConditionOp, string> = {
  is: 'is',
  is_not: 'is not',
  in: 'is one of',
  not_in: 'is none of',
  contains: 'contains',
  is_set: 'is filled in',
  is_empty: 'is empty',
  gte: 'is at least',
  lte: 'is at most',
};

export const conditionSchema = z
  .object({
    field: z.enum(CONDITION_FIELDS),
    op: z.enum(CONDITION_OPS),
    value: z.union([z.string().trim().max(120), z.array(z.string().trim().min(1).max(120)).max(30), z.number()]).optional(),
  })
  .superRefine((c, ctx) => {
    const needsList = c.op === 'in' || c.op === 'not_in';
    const needsNone = c.op === 'is_set' || c.op === 'is_empty';
    const needsNumber = c.op === 'gte' || c.op === 'lte';
    if (needsList && (!Array.isArray(c.value) || c.value.length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'List at least one value' });
    } else if (needsNumber && (typeof c.value !== 'number' || Number.isNaN(c.value))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Enter a number' });
    } else if (!needsList && !needsNone && !needsNumber && (typeof c.value !== 'string' || !c.value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Enter a value' });
    }
  });
export type Condition = z.output<typeof conditionSchema>;

/** The facts a condition is checked against. Missing facts are empty. */
export type ConditionFacts = Partial<Record<ConditionField, string | number | null | undefined>>;

function comparable(field: ConditionField, value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value).trim().toLowerCase().replace(/\s+/g, ' ');
  return field === 'targetCountry' ? normaliseCountry(s) : s;
}

export function evaluateCondition(c: Condition, facts: ConditionFacts): boolean {
  const raw = facts[c.field];
  const have = comparable(c.field, raw);
  switch (c.op) {
    case 'is_set':
      return have !== '';
    case 'is_empty':
      return have === '';
    case 'is':
      return have === comparable(c.field, c.value as string);
    case 'is_not':
      return have !== comparable(c.field, c.value as string);
    case 'in':
      return (c.value as string[]).some((v) => comparable(c.field, v) === have);
    case 'not_in':
      return !(c.value as string[]).some((v) => comparable(c.field, v) === have);
    case 'contains':
      return have.includes(comparable(c.field, c.value as string));
    case 'gte':
    case 'lte': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (raw === null || raw === undefined || Number.isNaN(n)) return false;
      return c.op === 'gte' ? n >= (c.value as number) : n <= (c.value as number);
    }
  }
}

/** Every condition must hold. No conditions: always. */
export function evaluateConditions(conditions: readonly Condition[] | null | undefined, facts: ConditionFacts): boolean {
  return (conditions ?? []).every((c) => evaluateCondition(c, facts));
}

export function describeCondition(c: Condition): string {
  const value = Array.isArray(c.value) ? c.value.join(', ') : c.value === undefined ? '' : String(c.value);
  return `${CONDITION_FIELD_LABEL[c.field]} ${CONDITION_OP_LABEL[c.op]}${value ? ` ${value}` : ''}`;
}

/* ------------------------------------------------------------------ */
/* Messages                                                             */
/* ------------------------------------------------------------------ */

export const MESSAGE_CHANNELS = ['in_app', 'email', 'sms', 'whatsapp'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
export const MESSAGE_CHANNEL_LABEL: Record<MessageChannel, string> = {
  in_app: 'In the app',
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
};

export const MESSAGE_AUDIENCES = ['student', 'consultant', 'managers'] as const;
export type MessageAudience = (typeof MESSAGE_AUDIENCES)[number];
export const MESSAGE_AUDIENCE_LABEL: Record<MessageAudience, string> = {
  student: 'The student',
  consultant: 'Their consultant',
  managers: 'Managers',
};

/** Placeholders a message may use; filled in when it is sent. */
export const MESSAGE_TOKENS = [
  { token: '{student}', label: 'Student’s full name' },
  { token: '{first_name}', label: 'Student’s first name' },
  { token: '{reference}', label: 'Application reference' },
  { token: '{stage}', label: 'Stage name, as the student sees it' },
  { token: '{country}', label: 'Destination' },
  { token: '{university}', label: 'University' },
  { token: '{consultant}', label: 'Consultant’s name' },
  { token: '{agency}', label: 'Your consultancy’s name' },
  { token: '{portal_link}', label: 'Link to the student’s portal' },
] as const;

export function renderMessage(text: string, vars: Record<string, string | null | undefined>): string {
  return text.replace(/\{([a-z_]+)\}/g, (whole, name: string) => {
    const v = vars[name];
    return v === undefined ? whole : (v ?? '');
  });
}

export const stageMessageSchema = z.object({
  audience: z.enum(MESSAGE_AUDIENCES),
  channels: z.array(z.enum(MESSAGE_CHANNELS)).min(1, 'Pick at least one channel').max(4),
  subject: z.string().trim().min(2, 'Give it a subject').max(150),
  body: z.string().trim().min(2, 'Write the message').max(2000),
});
export type StageMessage = z.output<typeof stageMessageSchema>;

/* ------------------------------------------------------------------ */
/* Stages                                                               */
/* ------------------------------------------------------------------ */

export const WORKFLOW_COLORS = ['slate', 'blue', 'violet', 'teal', 'green', 'amber', 'orange', 'rose'] as const;
export type WorkflowColor = (typeof WORKFLOW_COLORS)[number];

export const STAGE_MOVERS = ['staff', 'managers'] as const;
export type StageMover = (typeof STAGE_MOVERS)[number];

export const TASK_ASSIGNEES = ['consultant', 'managers'] as const;
export type TaskAssignee = (typeof TASK_ASSIGNEES)[number];

export const stageTaskSchema = z.object({
  title: z.string().trim().min(3, 'Say what needs doing').max(200),
  notes: optionalText(1000),
  dueInDays: z.coerce.number().int().min(0).max(365).default(2),
  assignee: z.enum(TASK_ASSIGNEES).default('consultant'),
  priority: z.enum(TASK_PRIORITIES).default('normal'),
});
export type StageTask = z.output<typeof stageTaskSchema>;

/** `invoice` issues it straight away; `task` asks the consultant to collect it. */
export const STAGE_FEE_MODES = ['task', 'invoice'] as const;
export type StageFeeMode = (typeof STAGE_FEE_MODES)[number];

export const stageFeeSchema = z.object({
  label: z.string().trim().min(2, 'What is the fee for?').max(120),
  /** Minor units (paisa, pence), like every amount the billing module holds. */
  amount: z.coerce.number().int().min(1, 'More than zero').max(10_000_000_000),
  currency: z.enum(CURRENCIES),
  mode: z.enum(STAGE_FEE_MODES).default('task'),
  dueInDays: z.coerce.number().int().min(0).max(180).default(7),
});
export type StageFee = z.output<typeof stageFeeSchema>;

const stageKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Lower-case letters, numbers and _, starting with a letter');

export const workflowStageSchema = z.object({
  key: stageKeySchema,
  name: z.string().trim().min(2, 'Name the stage').max(80),
  clientLabel: z.string().trim().min(2, 'What the student sees').max(80),
  clientDescription: z.string().trim().max(300).default(''),
  category: z.enum(STAGES),
  color: z.enum(WORKFLOW_COLORS).default('blue'),
  /** Days without movement before the application counts as stuck. */
  slaDays: z.coerce.number().int().min(1).max(3650).default(14),
  /** Document types (keys) that must all be approved before it moves on. */
  requiredDocuments: z.array(z.string().trim().min(2).max(40)).max(40).default([]),
  /** Move on by itself once every required document is approved. */
  autoAdvance: z.boolean().default(true),
  /** Someone with approval rights signs the stage off before it can be left. */
  approvalRequired: z.boolean().default(false),
  /** Who may move an application into or out of this stage by hand. */
  movableBy: z.enum(STAGE_MOVERS).default('staff'),
  /** The stage only applies when all of these hold - otherwise it is skipped. */
  conditions: z.array(conditionSchema).max(10).default([]),
  /** Created when an application enters the stage. */
  tasks: z.array(stageTaskSchema).max(10).default([]),
  fees: z.array(stageFeeSchema).max(10).default([]),
  messages: z.array(stageMessageSchema).max(10).default([]),
  /** The usual "your application moved to ..." notice to the student. */
  notifyStudent: z.boolean().default(true),
});
export type WorkflowStageInput = z.input<typeof workflowStageSchema>;
export type WorkflowStage = z.output<typeof workflowStageSchema>;

export const saveWorkflowDraftSchema = z
  .object({
    stages: z.array(workflowStageSchema).min(2, 'A workflow needs at least two stages').max(40),
    notes: optionalText(500),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.stages.forEach((s, i) => {
      if (seen.has(s.key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stages', i, 'key'], message: `“${s.key}” is used twice` });
      }
      seen.add(s.key);
      const prev = v.stages[i - 1];
      if (prev && STAGE_ORDER.indexOf(s.category) < STAGE_ORDER.indexOf(prev.category)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['stages', i, 'category'],
          message: `Comes after “${prev.name}”, so it cannot be an earlier step (${STAGE_DEFINITIONS[s.category].label}) than that one (${STAGE_DEFINITIONS[prev.category].label}).`,
        });
      }
    });
    const last = v.stages[v.stages.length - 1];
    if (last && last.category !== 'closed') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stages', v.stages.length - 1, 'category'],
        message: 'The last stage has to be a closing one (category “Case Closed / Departure”).',
      });
    }
    if (v.stages.length && v.stages.every((s) => s.conditions.length > 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stages'], message: 'At least one stage must apply to every application.' });
    }
  });
export type SaveWorkflowDraftInput = z.input<typeof saveWorkflowDraftSchema>;

export const workflowTemplateSchema = z.object({
  name: z.string().trim().min(2, 'Name the workflow').max(80),
  description: optionalText(300),
  /** Null: any destination. */
  country: z.string().trim().min(2).max(60).nullable().optional(),
  studyLevel: z.string().trim().min(2).max(60).nullable().optional(),
  visaType: z.string().trim().min(2).max(60).nullable().optional(),
});
export type WorkflowTemplateInput = z.input<typeof workflowTemplateSchema>;

export const createWorkflowSchema = workflowTemplateSchema.extend({
  /** Start from a copy of this workflow's current stages; the Standard one if not given. */
  copyFromId: uuidSchema.optional(),
});
export type CreateWorkflowInput = z.input<typeof createWorkflowSchema>;

export const publishWorkflowSchema = z.object({
  notes: optionalText(500),
  /** Move open applications on older versions of this workflow to the new one. */
  upgradeActive: z.boolean().default(false),
});
export type PublishWorkflowInput = z.input<typeof publishWorkflowSchema>;

export const changeCaseWorkflowSchema = z.object({
  versionId: uuidSchema,
  /** Where to land; by default the stage with the same key, then the same category. */
  stageKey: stageKeySchema.optional(),
  reason: z.string().trim().min(5, 'Say why, so the history makes sense later').max(500),
});
export type ChangeCaseWorkflowInput = z.input<typeof changeCaseWorkflowSchema>;

export const approveStageSchema = z.object({
  note: optionalText(500),
});
export type ApproveStageInput = z.input<typeof approveStageSchema>;

export const boardQuerySchema = z.object({
  templateId: uuidSchema.optional(),
  country: z.string().trim().max(60).optional(),
  consultantId: uuidSchema.optional(),
  q: z.string().trim().max(80).optional(),
  /** Cards per column; the column header always shows the full count. */
  perColumn: z.coerce.number().int().min(1).max(100).default(30),
});
export type BoardQuery = z.output<typeof boardQuerySchema>;

/* ------------------------------------------------------------------ */
/* Views                                                                */
/* ------------------------------------------------------------------ */

export type WorkflowVersionStatus = 'draft' | 'published' | 'retired';

export interface WorkflowStageView extends WorkflowStage {
  id: string;
  position: number;
}

export interface WorkflowSummaryView {
  id: string;
  name: string;
  description: string | null;
  country: string | null;
  studyLevel: string | null;
  visaType: string | null;
  isDefault: boolean;
  archived: boolean;
  current: { versionId: string; version: number; publishedAt: string; stageCount: number } | null;
  draft: { versionId: string; updatedAt: string } | null;
  activeCases: number;
  totalCases: number;
  updatedAt: string;
}

export interface WorkflowVersionSummary {
  id: string;
  version: number;
  status: WorkflowVersionStatus;
  notes: string | null;
  publishedAt: string | null;
  publishedByName: string | null;
  caseCount: number;
  activeCaseCount: number;
}

export interface WorkflowDetailView extends WorkflowSummaryView {
  versions: WorkflowVersionSummary[];
  currentStages: WorkflowStageView[] | null;
  draftStages: WorkflowStageView[] | null;
  draftNotes: string | null;
}

/** One stage as an application sees it. */
export interface CaseStageView {
  key: string;
  name: string;
  clientLabel: string;
  clientDescription: string;
  category: Stage;
  color: WorkflowColor;
  slaDays: number;
  requiredDocuments: string[];
  approvalRequired: boolean;
  movableBy: StageMover;
  autoAdvance: boolean;
  /** False when its conditions rule it out for this application: it is skipped. */
  applies: boolean;
}

export interface CaseWorkflowView {
  templateId: string;
  templateName: string;
  versionId: string;
  version: number;
  /** The newest published version of the same workflow, when this is not it. */
  newerVersion: { id: string; version: number } | null;
  stages: CaseStageView[];
  currentStageKey: string;
  approval: {
    required: boolean;
    approvedAt: string | null;
    approvedByName: string | null;
  };
}

export interface BoardCard {
  id: string;
  reference: string;
  clientId: string;
  clientName: string;
  consultantName: string | null;
  targetCountry: string;
  targetUniversity: string | null;
  intake: string | null;
  stageKey: string;
  daysInStage: number;
  slaDays: number;
  overdue: boolean;
  awaitingApproval: boolean;
  /** On an older version of the workflow. */
  versionBehind: boolean;
}

export interface BoardColumn {
  key: string;
  name: string;
  category: Stage;
  color: WorkflowColor;
  slaDays: number;
  approvalRequired: boolean;
  movableBy: StageMover;
  total: number;
  overdue: number;
  cards: BoardCard[];
}

export interface BoardView {
  workflow: { id: string; name: string; versionId: string; version: number; country: string | null };
  columns: BoardColumn[];
  /** Workflows the picker offers. */
  workflows: { id: string; name: string; country: string | null; activeCases: number }[];
}

export interface WorkflowPerformanceStage {
  key: string;
  name: string;
  category: Stage;
  slaDays: number;
  /** Open applications sitting here now. */
  active: number;
  /** Of those, past the stage's limit. */
  overdue: number;
  /** Applications that have ever entered it. */
  reached: number;
  /** Median and average days spent here, over completed visits. */
  medianDays: number | null;
  averageDays: number | null;
  /** Share of completed visits that took longer than the limit. */
  breachRate: number | null;
}

export interface WorkflowPerformanceView {
  workflowId: string;
  stages: WorkflowPerformanceStage[];
  totals: { active: number; overdue: number; started: number; closed: number };
}

/* ------------------------------------------------------------------ */
/* Moving along a workflow                                              */
/* ------------------------------------------------------------------ */

export interface StageLike {
  key: string;
  name: string;
  conditions?: readonly Condition[] | null;
}

export function stageApplies(stage: StageLike, facts: ConditionFacts): boolean {
  return evaluateConditions(stage.conditions, facts);
}

export function applicableStageKeys(stages: readonly StageLike[], facts: ConditionFacts): string[] {
  return stages.filter((s) => stageApplies(s, facts)).map((s) => s.key);
}

/** The next stage this application should move into, skipping ones that do not apply. */
export function nextStageKey(stages: readonly StageLike[], fromKey: string, facts: ConditionFacts): string | null {
  const from = stages.findIndex((s) => s.key === fromKey);
  for (let i = from + 1; i < stages.length; i++) {
    if (stageApplies(stages[i]!, facts)) return stages[i]!.key;
  }
  return null;
}

/**
 * "May this application move there, and does someone have to explain why" -
 * over any workflow. The ten-stage `checkStageTransition` is this function
 * over the Standard workflow.
 */
export function checkWorkflowTransition(
  stages: readonly StageLike[],
  fromKey: string,
  toKey: string,
  facts: ConditionFacts,
): TransitionCheck {
  const country = typeof facts.targetCountry === 'string' && facts.targetCountry ? facts.targetCountry : 'this';
  return transition(stages, fromKey, toKey, (s) => stageApplies(s, facts), country);
}

/**
 * The same check over stages the API has already marked as applying or not -
 * what a page receives with an application, where the conditions themselves
 * are not sent.
 */
export function checkCaseStageTransition(
  stages: readonly { key: string; name: string; applies: boolean }[],
  fromKey: string,
  toKey: string,
  targetCountry?: string | null,
): TransitionCheck {
  return transition(stages, fromKey, toKey, (s) => s.applies, targetCountry || 'this');
}

/** The next stage that applies, over stages already marked. */
export function nextCaseStageKey(stages: readonly { key: string; applies: boolean }[], fromKey: string): string | null {
  const from = stages.findIndex((s) => s.key === fromKey);
  for (let i = from + 1; i < stages.length; i++) if (stages[i]!.applies) return stages[i]!.key;
  return null;
}

function transition<S extends { key: string; name: string }>(
  stages: readonly S[],
  fromKey: string,
  toKey: string,
  applies: (s: S) => boolean,
  country: string,
): TransitionCheck {
  const to = stages.find((s) => s.key === toKey);
  if (!to) {
    return { allowed: false, kind: 'not-applicable', requiresReason: false, message: 'That stage is not part of this application’s workflow.' };
  }
  if (fromKey === toKey) {
    return { allowed: false, kind: 'same', requiresReason: false, message: 'The case is already at this stage.' };
  }
  if (!applies(to)) {
    return { allowed: false, kind: 'not-applicable', requiresReason: false, message: `${to.name} does not apply to a ${country} application.` };
  }
  const keys = stages.filter(applies).map((s) => s.key);
  const fromIdx = keys.indexOf(fromKey);
  const toIdx = keys.indexOf(toKey);
  if (fromIdx >= 0 && toIdx < fromIdx) {
    return { allowed: true, kind: 'back', requiresReason: true, message: `Moving back to ${to.name}.` };
  }
  const from = stages.findIndex((s) => s.key === fromKey);
  let next: string | null = null;
  for (let i = from + 1; i < stages.length; i++) {
    if (applies(stages[i]!)) {
      next = stages[i]!.key;
      break;
    }
  }
  if (toKey === next) {
    return { allowed: true, kind: 'next', requiresReason: false, message: `Moving forward to ${to.name}.` };
  }
  return {
    allowed: true,
    kind: 'skip',
    requiresReason: true,
    message: `Skipping ${Math.max(0, toIdx - fromIdx - 1)} step(s) ahead to ${to.name}.`,
  };
}

/** The facts of an application that stage conditions and automations read. */
export function caseFacts(c: {
  targetCountry: string | null;
  studyLevel?: string | null;
  visaType?: string | null;
  intake?: string | null;
  targetUniversity?: string | null;
  leadSource?: string | null;
  status?: string | null;
}): ConditionFacts {
  return {
    targetCountry: c.targetCountry,
    studyLevel: c.studyLevel ?? null,
    visaType: c.visaType ?? null,
    intake: c.intake ?? null,
    targetUniversity: c.targetUniversity ?? null,
    leadSource: c.leadSource ?? null,
    status: c.status ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* The Standard workflow                                                */
/* ------------------------------------------------------------------ */

const STANDARD_COLOR: Record<Stage, WorkflowColor> = {
  inquiry: 'slate',
  shortlisting: 'blue',
  documents_collection: 'violet',
  application_submitted: 'blue',
  offer_letter: 'teal',
  fee_payment: 'amber',
  visa_filed: 'orange',
  visa_interview: 'orange',
  visa_decision: 'rose',
  closed: 'green',
};

/**
 * Today's ten stages as a workflow - what every consultancy starts with and
 * what every application that existed before workflows runs on. Its
 * behaviour is pinned by tests to match the fixed pipeline exactly.
 */
export const STANDARD_WORKFLOW_STAGES: WorkflowStage[] = STAGE_ORDER.map((stage) => {
  const def = STAGE_DEFINITIONS[stage];
  return workflowStageSchema.parse({
    key: stage,
    name: def.label,
    clientLabel: def.clientLabel,
    clientDescription: def.clientDescription,
    category: stage,
    color: STANDARD_COLOR[stage],
    slaDays: def.stuckAfterDays,
    requiredDocuments: [...def.requiredDocuments],
    autoAdvance: true,
    approvalRequired: false,
    movableBy: 'staff',
    conditions: stage === 'visa_interview' ? [{ field: 'targetCountry', op: 'in', value: ['United States'] }] : [],
    tasks: [],
    fees: [],
    messages: [],
    notifyStudent: true,
  });
});

/* ------------------------------------------------------------------ */
/* Automations                                                          */
/* ------------------------------------------------------------------ */

export const AUTOMATION_TRIGGERS = [
  'case_created',
  'stage_entered',
  'stage_left',
  'status_changed',
  'document_uploaded',
  'document_approved',
  'document_rejected',
  'case_stuck',
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export const AUTOMATION_TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  case_created: 'An application is opened',
  stage_entered: 'An application enters a stage',
  stage_left: 'An application leaves a stage',
  status_changed: 'An application’s status changes',
  document_uploaded: 'A document is uploaded',
  document_approved: 'A document is approved',
  document_rejected: 'A document is rejected or sent back',
  case_stuck: 'An application goes past its stage’s time limit',
};

export const AUTOMATION_ACTIONS = ['create_task', 'notify', 'send_message', 'move_stage', 'set_status'] as const;
export type AutomationActionType = (typeof AUTOMATION_ACTIONS)[number];

export const AUTOMATION_ACTION_LABEL: Record<AutomationActionType, string> = {
  create_task: 'Create a task',
  notify: 'Notify in the app',
  send_message: 'Send a message',
  move_stage: 'Move the application',
  set_status: 'Change its status',
};

/** Statuses an automation may set - never a visa outcome, which a person records. */
export const AUTOMATION_STATUSES = ['active', 'on_hold', 'withdrawn'] as const;

export const automationActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create_task'), task: stageTaskSchema }),
  z.object({
    type: z.literal('notify'),
    audience: z.enum(MESSAGE_AUDIENCES),
    title: z.string().trim().min(2).max(150),
    body: z.string().trim().max(500).default(''),
  }),
  z.object({ type: z.literal('send_message'), message: stageMessageSchema }),
  z.object({ type: z.literal('move_stage'), stageKey: stageKeySchema }),
  z.object({ type: z.literal('set_status'), status: z.enum(AUTOMATION_STATUSES) }),
]);
export type AutomationAction = z.output<typeof automationActionSchema>;

export const automationRuleSchema = z
  .object({
    name: z.string().trim().min(2, 'Name the automation').max(120),
    enabled: z.boolean().default(true),
    trigger: z.enum(AUTOMATION_TRIGGERS),
    /** Only applications on this workflow; any workflow if not set. */
    workflowId: uuidSchema.nullable().optional(),
    /** For the stage triggers: which stage (key). Any stage if not set. */
    stageKey: stageKeySchema.nullable().optional(),
    /** For the document triggers: which document type. Any if not set. */
    documentType: z.string().trim().min(2).max(40).nullable().optional(),
    conditions: z.array(conditionSchema).max(10).default([]),
    actions: z.array(automationActionSchema).min(1, 'Add at least one action').max(10),
  })
  .superRefine((v, ctx) => {
    if (v.stageKey && v.trigger !== 'stage_entered' && v.trigger !== 'stage_left' && v.trigger !== 'case_stuck') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stageKey'], message: 'Only the stage triggers look at a stage' });
    }
    if (v.documentType && !v.trigger.startsWith('document_')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['documentType'], message: 'Only the document triggers look at a document type' });
    }
    v.actions.forEach((a, i) => {
      if (a.type === 'move_stage' && v.trigger === 'stage_entered' && v.stageKey && a.stageKey === v.stageKey) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['actions', i, 'stageKey'], message: 'It is already there when this runs' });
      }
    });
  });
export type AutomationRuleInput = z.input<typeof automationRuleSchema>;
export type AutomationRule = z.output<typeof automationRuleSchema>;

export interface AutomationRuleView extends AutomationRule {
  id: string;
  workflowName: string | null;
  runCount: number;
  lastRunAt: string | null;
  createdByName: string | null;
  updatedAt: string;
}

export type AutomationRunStatus = 'done' | 'partial' | 'failed' | 'skipped';

export interface AutomationRunView {
  id: string;
  ruleId: string;
  ruleName: string;
  trigger: AutomationTrigger;
  status: AutomationRunStatus;
  caseId: string | null;
  caseReference: string | null;
  clientName: string | null;
  /** One line per action: what it did, or why it did not. */
  results: { action: AutomationActionType; ok: boolean; detail: string }[];
  createdAt: string;
}

export const automationRunsQuerySchema = z.object({
  ruleId: uuidSchema.optional(),
  status: z.enum(['done', 'partial', 'failed', 'skipped']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
export type AutomationRunsQuery = z.output<typeof automationRunsQuerySchema>;

export function describeAction(a: AutomationAction): string {
  switch (a.type) {
    case 'create_task':
      return `Task for ${MESSAGE_AUDIENCE_LABEL[a.task.assignee === 'consultant' ? 'consultant' : 'managers'].toLowerCase()}: “${a.task.title}”, due in ${a.task.dueInDays} day(s)`;
    case 'notify':
      return `Tell ${MESSAGE_AUDIENCE_LABEL[a.audience].toLowerCase()}: “${a.title}”`;
    case 'send_message':
      return `${a.message.channels.map((c) => MESSAGE_CHANNEL_LABEL[c]).join(' + ')} to ${MESSAGE_AUDIENCE_LABEL[a.message.audience].toLowerCase()}: “${a.message.subject}”`;
    case 'move_stage':
      return `Move to stage “${a.stageKey}”`;
    case 'set_status':
      return `Set status to ${a.status.replace('_', ' ')}`;
  }
}

