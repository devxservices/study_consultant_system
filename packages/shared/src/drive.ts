import { z } from 'zod';
import { DOCUMENT_META, DOCUMENT_STATUSES, DOCUMENT_TYPES, type DocumentStatus, type DocumentType } from './documents';
import { UPLOAD_TYPE_KEYS, type UploadTypeKey } from './documents';
import { dateOnlySchema } from './profile';
import { uuidSchema } from './dto/common';

/* ------------------------------------------------------------------ */
/* Folders                                                             */
/* ------------------------------------------------------------------ */

/**
 * The folders every student's drive starts with. A consultancy can rename
 * them, add more, or keep a different set per country (folder templates);
 * the keys are what uploads are filed by.
 */
export const SYSTEM_FOLDERS = [
  { key: 'passport', name: 'Passport and ID' },
  { key: 'academic', name: 'Academic' },
  { key: 'language', name: 'Language tests' },
  { key: 'financial', name: 'Financial' },
  { key: 'application', name: 'Application documents' },
  { key: 'offers', name: 'Offer letters' },
  { key: 'visa', name: 'Visa' },
  { key: 'other', name: 'Other' },
] as const;
export type SystemFolderKey = (typeof SYSTEM_FOLDERS)[number]['key'];

/** Where each built-in document type is filed. */
export const DOCUMENT_TYPE_FOLDER: Record<DocumentType, SystemFolderKey> = {
  passport: 'passport',
  cnic: 'passport',
  photograph: 'passport',
  transcript: 'academic',
  degree_certificate: 'academic',
  language_test: 'language',
  bank_statement: 'financial',
  sponsor_affidavit: 'financial',
  sop: 'application',
  recommendation_letter: 'application',
  cv: 'application',
  experience_letter: 'application',
  offer_letter: 'offers',
  fee_receipt: 'financial',
  i20_cas: 'offers',
  visa_form: 'visa',
  police_clearance: 'visa',
  medical_report: 'visa',
  other: 'other',
};

/** Built-in types whose validity runs out, and so carry an expiry date. */
export const EXPIRING_TYPES: readonly string[] = [
  'passport',
  'language_test',
  'bank_statement',
  'police_clearance',
  'medical_report',
  'visa_grant',
];

/** Types every consultancy has beyond the original nineteen. */
export const EXTRA_SYSTEM_TYPES = [
  { key: 'visa_grant', label: 'Visa grant', hint: 'The visa itself, or the grant letter.', folder: 'visa' as SystemFolderKey },
  { key: 'payment_proof', label: 'Proof of payment', hint: 'A bank slip or screenshot of a transfer.', folder: 'financial' as SystemFolderKey },
  { key: 'agreement', label: 'Signed agreement', hint: 'An agreement signed with the consultancy.', folder: 'other' as SystemFolderKey },
] as const;

export const FOLDER_COLORS = ['slate', 'blue', 'teal', 'green', 'amber', 'red', 'purple'] as const;
export type FolderColor = (typeof FOLDER_COLORS)[number];

/* ------------------------------------------------------------------ */
/* Classifying and naming                                              */
/* ------------------------------------------------------------------ */

const CLASSIFY: [RegExp, string][] = [
  [/passport|\bpp\b/i, 'passport'],
  [/cnic|national.?id|\bnic\b|identity/i, 'cnic'],
  [/photo|picture|selfie/i, 'photograph'],
  [/transcript|marksheet|mark.?sheet|result.?card|dmc/i, 'transcript'],
  [/degree|diploma|certificate|matric|inter(mediate)?|o.?level|a.?level|hssc|ssc/i, 'degree_certificate'],
  [/ielts|toefl|\bpte\b|duolingo|\btrf\b|language/i, 'language_test'],
  [/bank|statement|balance/i, 'bank_statement'],
  [/affidavit|sponsor/i, 'sponsor_affidavit'],
  [/\bsop\b|statement.?of.?purpose|personal.?statement/i, 'sop'],
  [/\blor\b|recommend|reference.?letter/i, 'recommendation_letter'],
  [/\bcv\b|resume|résumé/i, 'cv'],
  [/experience|employment|job.?letter/i, 'experience_letter'],
  [/offer|admission|acceptance/i, 'offer_letter'],
  [/\bcas\b|i-?20|\bcoe\b|confirmation.?of.?(enrol|accept)/i, 'i20_cas'],
  [/receipt|deposit|fee.?(paid|slip)|challan/i, 'fee_receipt'],
  [/visa.?(form|application)|ds-?160|vaf/i, 'visa_form'],
  [/visa.?(grant|approv)|\bbrp\b|\bevisa\b/i, 'visa_grant'],
  [/police|character.?cert|pcc/i, 'police_clearance'],
  [/medical|tb.?test|health/i, 'medical_report'],
];

/**
 * A best guess at a document's type from its file name - "Ali_IELTS_TRF.pdf"
 * is a language test. Only ever a suggestion: the uploader or reviewer can
 * change it, and nothing is decided on a guess alone.
 */
export function classifyFileName(fileName: string): string | null {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_\-.]+/g, ' ');
  for (const [pattern, type] of CLASSIFY) if (pattern.test(base)) return type;
  return null;
}

export const RENAME_TOKENS = ['{student}', '{type}', '{date}', '{application}', '{original}', '{version}'] as const;
export const DEFAULT_RENAME_PATTERN = '{student}_{type}';

/**
 * The name a document is downloaded under, from the consultancy's pattern:
 * "{student}_{type}" gives Ali_Khan_Passport.pdf. Characters a file system
 * would choke on are removed; the extension always survives.
 */
export function renameForDownload(
  pattern: string,
  doc: { studentName: string; typeLabel: string; uploadedAt: string; caseReference: string | null; fileName: string; version: number },
): string {
  const ext = /\.[a-z0-9]+$/i.exec(doc.fileName)?.[0] ?? '';
  const original = doc.fileName.slice(0, doc.fileName.length - ext.length);
  const clean = (v: string) => v.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-]/g, '');
  const out = (pattern || DEFAULT_RENAME_PATTERN)
    .replace(/\{student\}/g, clean(doc.studentName))
    .replace(/\{type\}/g, clean(doc.typeLabel))
    .replace(/\{date\}/g, doc.uploadedAt.slice(0, 10))
    .replace(/\{application\}/g, clean(doc.caseReference ?? ''))
    .replace(/\{original\}/g, clean(original))
    .replace(/\{version\}/g, `v${doc.version}`)
    .replace(/_{2,}/g, '_')
    .replace(/^[_\-]+|[_\-]+$/g, '');
  return `${out || clean(original) || 'document'}${ext}`;
}

/** Label for a type key, built-in or the consultancy's own. */
export function typeLabel(key: string, custom?: { key: string; label: string }[]): string {
  const own = custom?.find((t) => t.key === key);
  if (own) return own.label;
  if ((DOCUMENT_TYPES as readonly string[]).includes(key)) return DOCUMENT_META[key as DocumentType].label;
  const extra = EXTRA_SYSTEM_TYPES.find((t) => t.key === key);
  return extra?.label ?? key.replace(/_/g, ' ');
}

/* ------------------------------------------------------------------ */
/* Wire shapes                                                         */
/* ------------------------------------------------------------------ */

export interface DriveFolderView {
  id: string;
  name: string;
  parentId: string | null;
  clientId: string | null;
  partnerId: string | null;
  systemKey: string | null;
  color: string | null;
  restricted: boolean;
  sharedWithPartners: boolean;
  starred: boolean;
  documentCount: number;
  folderCount: number;
  trashedAt: string | null;
  updatedAt: string;
}

export interface DriveDocumentView {
  id: string;
  fileName: string;
  clientId: string | null;
  clientName: string | null;
  caseId: string | null;
  caseReference: string | null;
  targetCountry: string | null;
  folderId: string | null;
  folderName: string | null;
  typeKey: string;
  typeLabel: string;
  status: DocumentStatus;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
  uploadedById: string;
  uploadedByName: string;
  uploadedByRole: string;
  reviewerComment: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  expiresOn: string | null;
  issuedOn: string | null;
  /** Days until it expires; negative once it has. */
  daysToExpiry: number | null;
  tags: string[];
  color: string | null;
  starred: boolean;
  version: number;
  versionCount: number;
  versionGroup: string;
  /** Same bytes as another of this student's documents. */
  duplicateOfId: string | null;
  trashedAt: string | null;
  /** Inline, for previews. Always an authorised route. */
  fileUrl: string;
  /** As an attachment, under the consultancy's naming pattern. */
  downloadUrl: string;
  canTrash: boolean;
  canReview: boolean;
  canOrganise: boolean;
}

export interface DriveCrumb {
  id: string | null;
  name: string;
  /** What clicking it shows. */
  kind: 'root' | 'students' | 'student' | 'agency' | 'partners' | 'partner' | 'folder';
  clientId?: string | null;
}

export interface DriveListing {
  folder: DriveFolderView | null;
  breadcrumb: DriveCrumb[];
  folders: DriveFolderView[];
  documents: DriveDocumentView[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DriveStudentView {
  clientId: string;
  name: string;
  email: string;
  consultantName: string | null;
  documentCount: number;
  pendingCount: number;
  /** Across the student's applications, the average checklist completion. */
  completion: number | null;
  lastUploadAt: string | null;
}

export interface DocumentVersionView {
  id: string;
  version: number;
  fileName: string;
  fileSize: number;
  status: DocumentStatus;
  uploadedAt: string;
  uploadedByName: string;
  reviewerComment: string | null;
  current: boolean;
  fileUrl: string;
}

export interface ChecklistItemView {
  typeKey: string;
  label: string;
  hint: string | null;
  required: boolean;
  note: string | null;
  status: DocumentStatus | 'missing';
  documentId: string | null;
  expiresOn: string | null;
  expired: boolean;
}

export interface ApplicationChecklistView {
  caseId: string | null;
  reference: string | null;
  targetCountry: string | null;
  setName: string;
  items: ChecklistItemView[];
  required: number;
  approved: number;
  /** Approved required documents, as a whole percentage. */
  percent: number;
}

export interface StudentChecklistView {
  clientId: string;
  applications: ApplicationChecklistView[];
  overall: number;
}

export interface DriveSettingsView {
  acceptedTypes: UploadTypeKey[];
  maxFileMb: number;
  renamePattern: string;
  retentionDays: number;
  expiryReminderDays: number[];
}

export interface DocumentTypeView {
  id: string;
  key: string;
  label: string;
  hint: string | null;
  folderKey: string;
  hasExpiry: boolean;
  system: boolean;
  active: boolean;
}

export interface RequirementItem {
  typeKey: string;
  required: boolean;
  note?: string | null;
}

export interface RequirementSetView {
  id: string;
  name: string;
  country: string | null;
  studyLevel: string | null;
  visaType: string | null;
  items: RequirementItem[];
  active: boolean;
}

export interface FolderTemplateView {
  id: string;
  name: string;
  country: string | null;
  folders: { key: string; name: string }[];
  isDefault: boolean;
}

export interface ShareLinkView {
  id: string;
  label: string;
  documentId: string | null;
  folderId: string | null;
  targetName: string;
  clientName: string | null;
  expiresAt: string;
  viewOnly: boolean;
  hasPassword: boolean;
  views: number;
  lastAccessAt: string | null;
  revokedAt: string | null;
  createdByName: string | null;
  createdAt: string;
  active: boolean;
}

export interface ShareCreated extends ShareLinkView {
  /** Shown once. The server keeps only its hash. */
  token: string;
}

export interface ShareAccessView {
  at: string;
  action: 'view' | 'download' | 'denied_password' | 'expired' | 'revoked';
  documentName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

/** What someone holding a share link sees, before and after the password. */
export interface PublicShareView {
  consultancy: string;
  label: string;
  kind: 'document' | 'folder';
  name: string;
  expiresAt: string;
  viewOnly: boolean;
  needsPassword: boolean;
  items: { id: string; fileName: string; mimeType: string; fileSize: number; typeLabel: string }[] | null;
}

export interface GrantView {
  id: string;
  resourceType: 'folder' | 'document';
  resourceId: string;
  resourceName: string;
  userId: string;
  userName: string;
  access: 'view' | 'edit';
  createdAt: string;
}

export interface UploadSessionView {
  id: string;
  received: number;
  size: number;
  chunkSize: number;
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

const name = z.string().trim().min(1, 'Give it a name').max(120);
const typeKey = z.string().trim().regex(/^[a-z0-9_]{2,40}$/, 'Use lower-case letters, numbers and _');

export const DRIVE_VIEWS = ['all', 'starred', 'recent', 'trash', 'expiring', 'review', 'shared'] as const;
export type DriveView = (typeof DRIVE_VIEWS)[number];

export const driveListQuerySchema = z.object({
  folderId: uuidSchema.optional(),
  clientId: uuidSchema.optional(),
  /** The agency's own area (folders with no student), or the partners' area. */
  area: z.enum(['students', 'agency', 'partners']).optional(),
  view: z.enum(DRIVE_VIEWS).optional(),
  q: z.string().trim().max(120).optional(),
  type: z.string().trim().max(40).optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  country: z.string().trim().max(60).optional(),
  caseId: uuidSchema.optional(),
  uploaderId: uuidSchema.optional(),
  uploaderRole: z.enum(['client', 'staff', 'partner']).optional(),
  tag: z.string().trim().max(40).optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  expiringWithin: z.coerce.number().int().min(0).max(3650).optional(),
  // Unset: newest first, or soonest to run out in the Expiring view.
  sort: z.enum(['name', 'newest', 'oldest', 'size', 'status', 'expiry']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type DriveListQuery = z.infer<typeof driveListQuerySchema>;

export const studentsQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type StudentsQuery = z.infer<typeof studentsQuerySchema>;

export const createFolderSchema = z.object({
  name,
  parentId: uuidSchema.nullable().optional(),
  clientId: uuidSchema.nullable().optional(),
  color: z.enum(FOLDER_COLORS).nullable().optional(),
  restricted: z.boolean().optional(),
  sharedWithPartners: z.boolean().optional(),
});
export type CreateFolderInput = z.infer<typeof createFolderSchema>;

export const updateFolderSchema = z.object({
  name: name.optional(),
  parentId: uuidSchema.nullable().optional(),
  color: z.enum(FOLDER_COLORS).nullable().optional(),
  restricted: z.boolean().optional(),
  sharedWithPartners: z.boolean().optional(),
});
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;

export const updateDocumentSchema = z.object({
  fileName: z.string().trim().min(1).max(160).optional(),
  folderId: uuidSchema.nullable().optional(),
  caseId: uuidSchema.nullable().optional(),
  typeKey: typeKey.optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  color: z.enum(FOLDER_COLORS).nullable().optional(),
  expiresOn: dateOnlySchema.nullable().optional(),
  issuedOn: dateOnlySchema.nullable().optional(),
});
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

export const copyDocumentSchema = z.object({ folderId: uuidSchema });
export type CopyDocumentInput = z.infer<typeof copyDocumentSchema>;

export const starSchema = z.object({
  itemType: z.enum(['folder', 'document']),
  itemId: uuidSchema,
  starred: z.boolean(),
});
export type StarInput = z.infer<typeof starSchema>;

export const REVIEW_STATUSES = ['under_review', 'verified', 'rejected', 'reupload_requested'] as const;
export const setStatusSchema = z
  .object({
    status: z.enum(REVIEW_STATUSES),
    comment: z.string().trim().max(500).optional(),
  })
  .refine((v) => !['rejected', 'reupload_requested'].includes(v.status) || (v.comment?.length ?? 0) >= 10, {
    message: 'Tell the student what to fix, in a full sentence.',
    path: ['comment'],
  });
export type SetStatusInput = z.infer<typeof setStatusSchema>;

export const BULK_ACTIONS = ['trash', 'restore', 'move', 'tag', 'approve', 'under_review'] as const;
export const bulkSchema = z.object({
  action: z.enum(BULK_ACTIONS),
  documentIds: z.array(uuidSchema).min(1).max(200),
  folderId: uuidSchema.optional(),
  tag: z.string().trim().min(1).max(40).optional(),
});
export type BulkInput = z.infer<typeof bulkSchema>;

export const driveUploadFieldsSchema = z.object({
  clientId: uuidSchema.optional(),
  caseId: uuidSchema.optional(),
  folderId: uuidSchema.optional(),
  typeKey: typeKey.optional(),
  replacesId: uuidSchema.optional(),
  expiresOn: dateOnlySchema.optional(),
  issuedOn: dateOnlySchema.optional(),
});
export type DriveUploadFields = z.infer<typeof driveUploadFieldsSchema>;

export const startUploadSchema = driveUploadFieldsSchema.extend({
  fileName: z.string().trim().min(1).max(200),
  size: z.coerce.number().int().min(1),
});
export type StartUploadInput = z.infer<typeof startUploadSchema>;

export const createShareSchema = z
  .object({
    documentId: uuidSchema.optional(),
    folderId: uuidSchema.optional(),
    label: z.string().trim().min(2, 'Say who it is for, e.g. University of Leeds admissions').max(120),
    expiresInDays: z.coerce.number().int().min(1).max(90).default(7),
    password: z.string().min(6, 'At least 6 characters').max(100).optional(),
    viewOnly: z.boolean().default(false),
  })
  .refine((v) => Boolean(v.documentId) !== Boolean(v.folderId), {
    message: 'Share one document or one folder.',
    path: ['documentId'],
  });
export type CreateShareInput = z.infer<typeof createShareSchema>;

export const unlockShareSchema = z.object({ password: z.string().min(1).max(100) });
export type UnlockShareInput = z.infer<typeof unlockShareSchema>;

export const driveSettingsSchema = z.object({
  acceptedTypes: z.array(z.enum(UPLOAD_TYPE_KEYS)).min(1, 'Accept at least one kind of file'),
  maxFileMb: z.coerce.number().int().min(1).max(25),
  renamePattern: z.string().trim().min(3).max(120),
  retentionDays: z.coerce.number().int().min(1).max(3650),
  expiryReminderDays: z.array(z.coerce.number().int().min(0).max(365)).min(1).max(6),
});
export type DriveSettingsInput = z.infer<typeof driveSettingsSchema>;

export const documentTypeSchema = z.object({
  key: typeKey,
  label: z.string().trim().min(2).max(80),
  hint: z.string().trim().max(240).nullable().optional(),
  folderKey: z.string().trim().min(2).max(40),
  hasExpiry: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type DocumentTypeInput = z.infer<typeof documentTypeSchema>;

export const requirementSetSchema = z.object({
  name: z.string().trim().min(2).max(120),
  country: z.string().trim().max(60).nullable().optional(),
  studyLevel: z.string().trim().max(60).nullable().optional(),
  visaType: z.string().trim().max(60).nullable().optional(),
  items: z
    .array(z.object({ typeKey, required: z.boolean().default(true), note: z.string().trim().max(200).nullable().optional() }))
    .min(1, 'Add at least one document')
    .max(60),
  active: z.boolean().default(true),
});
export type RequirementSetInput = z.infer<typeof requirementSetSchema>;

export const folderTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  country: z.string().trim().max(60).nullable().optional(),
  folders: z
    .array(z.object({ key: z.string().trim().regex(/^[a-z0-9_]{2,40}$/), name: z.string().trim().min(1).max(80) }))
    .min(1)
    .max(30),
  isDefault: z.boolean().default(false),
});
export type FolderTemplateInput = z.infer<typeof folderTemplateSchema>;

export const grantSchema = z.object({
  resourceType: z.enum(['folder', 'document']),
  resourceId: uuidSchema,
  userId: uuidSchema,
  access: z.enum(['view', 'edit']).default('view'),
});
export type GrantInput = z.infer<typeof grantSchema>;

export const DEFAULT_DRIVE_SETTINGS: DriveSettingsView = {
  acceptedTypes: ['pdf', 'jpg', 'png', 'webp', 'heic', 'docx'],
  maxFileMb: 15,
  renamePattern: DEFAULT_RENAME_PATTERN,
  retentionDays: 30,
  expiryReminderDays: [90, 30, 7, 0],
};
