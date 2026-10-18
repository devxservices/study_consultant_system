/**
 * Document types a study-visa case can involve.
 * Values are stable DB identifiers - never rename one without a migration.
 */
export const DOCUMENT_TYPES = [
  'passport',
  'cnic',
  'photograph',
  'transcript',
  'degree_certificate',
  'language_test',
  'bank_statement',
  'sponsor_affidavit',
  'sop',
  'recommendation_letter',
  'cv',
  'experience_letter',
  'offer_letter',
  'fee_receipt',
  'i20_cas',
  'visa_form',
  'police_clearance',
  'medical_report',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/**
 * Plain-English labels and hints. The hint is shown to clients under the
 * upload slot so a non-technical user knows exactly what to photograph/scan.
 */
export const DOCUMENT_META: Record<DocumentType, { label: string; hint: string }> = {
  passport: {
    label: 'Passport',
    hint: 'Photo page only. Must be valid for at least 6 more months.',
  },
  cnic: {
    label: 'CNIC / National ID',
    hint: 'Front and back, in one file if possible.',
  },
  photograph: {
    label: 'Passport-size Photograph',
    hint: 'White background, taken within the last 6 months.',
  },
  transcript: {
    label: 'Academic Transcript',
    hint: 'Marksheets for your most recent qualification, all semesters/years.',
  },
  degree_certificate: {
    label: 'Degree / Certificate',
    hint: 'Your final degree or matric/intermediate certificate.',
  },
  language_test: {
    label: 'Language Test Result',
    hint: 'IELTS, PTE, TOEFL or Duolingo score report.',
  },
  bank_statement: {
    label: 'Bank Statement',
    hint: 'Last 6 months, stamped by the bank.',
  },
  sponsor_affidavit: {
    label: 'Sponsor Affidavit',
    hint: 'Signed affidavit of financial support from your sponsor.',
  },
  sop: {
    label: 'Statement of Purpose',
    hint: 'Why you chose this course and country. Your consultant can help you draft it.',
  },
  recommendation_letter: {
    label: 'Recommendation Letter',
    hint: 'From a teacher or employer, on official letterhead.',
  },
  cv: { label: 'CV / Resume', hint: 'One or two pages, education and any work experience.' },
  experience_letter: {
    label: 'Experience Letter',
    hint: 'Only if you have work experience to show.',
  },
  offer_letter: {
    label: 'Offer Letter',
    hint: 'The admission letter sent to you by the university.',
  },
  fee_receipt: { label: 'Tuition Fee Receipt', hint: 'Proof that the deposit has been paid.' },
  i20_cas: {
    label: 'I-20 / CAS / CoE',
    hint: 'The enrolment confirmation the university issues after your fee payment.',
  },
  visa_form: { label: 'Visa Application Form', hint: 'The completed and signed application form.' },
  police_clearance: { label: 'Police Clearance', hint: 'Character certificate from the police.' },
  medical_report: { label: 'Medical Report', hint: 'From a panel-approved clinic only.' },
  other: { label: 'Other Document', hint: 'Anything else your consultant has asked you for.' },
};

/**
 * Uploaded -> Under review -> Approved, or Rejected (with a reason), or
 * Re-upload requested (send a better copy). Values are stable DB identifiers:
 * `pending` is "Uploaded" and `verified` is "Approved".
 */
export const DOCUMENT_STATUSES = ['pending', 'verified', 'rejected', 'under_review', 'reupload_requested'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  pending: 'Uploaded',
  under_review: 'Under review',
  verified: 'Approved',
  rejected: 'Rejected',
  reupload_requested: 'Re-upload requested',
};

/** The same statuses, in the words a student reads them. */
export const DOCUMENT_STATUS_CLIENT_LABEL: Record<DocumentStatus, string> = {
  pending: 'Sent - waiting to be checked',
  under_review: 'Being checked',
  verified: 'Approved',
  rejected: 'Not accepted - see why',
  reupload_requested: 'Please send it again',
};

export const DOCUMENT_STATUS_TONE: Record<DocumentStatus, 'ok' | 'warn' | 'bad' | 'neutral' | 'info'> = {
  pending: 'warn',
  under_review: 'info',
  verified: 'ok',
  rejected: 'bad',
  reupload_requested: 'bad',
};

/** Statuses that ask the student to act. */
export const NEEDS_NEW_UPLOAD: readonly DocumentStatus[] = ['rejected', 'reupload_requested'];

export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Every file type the platform can accept; each consultancy picks from these. */
export const UPLOAD_TYPES = [
  { key: 'pdf', label: 'PDF', mime: 'application/pdf', extensions: ['.pdf'] },
  { key: 'jpg', label: 'JPG', mime: 'image/jpeg', extensions: ['.jpg', '.jpeg'] },
  { key: 'png', label: 'PNG', mime: 'image/png', extensions: ['.png'] },
  { key: 'webp', label: 'WEBP', mime: 'image/webp', extensions: ['.webp'] },
  { key: 'heic', label: 'HEIC', mime: 'image/heic', extensions: ['.heic', '.heif'] },
  { key: 'docx', label: 'Word (DOCX)', mime: DOCX_MIME_TYPE, extensions: ['.docx'] },
] as const;
export type UploadTypeKey = (typeof UPLOAD_TYPES)[number]['key'];
export const UPLOAD_TYPE_KEYS = UPLOAD_TYPES.map((t) => t.key) as unknown as readonly [UploadTypeKey, ...UploadTypeKey[]];

/** The largest file any consultancy can allow, whatever it sets. */
export const UPLOAD_CEILING_MB = 25;

/** Upload constraints, enforced on the client for UX and again on the server for real. */
export const UPLOAD_LIMITS = {
  maxBytes: 15 * 1024 * 1024,
  acceptedMimeTypes: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    DOCX_MIME_TYPE,
  ] as const,
  /** Images above this are downscaled in the browser before upload. */
  compressImagesOverBytes: 1024 * 1024,
  maxImageDimension: 2200,
} as const;

/**
 * The most live documents a single case may hold. Enforced on the server for
 * real and mirrored in the client so the "add" control stops offering uploads
 * once the case is full. A re-upload that replaces a rejected file does not
 * count against this, because it supersedes the file it replaces.
 */
export const MAX_DOCUMENTS_PER_CASE = 30;

export function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === 'string' && (DOCUMENT_TYPES as readonly string[]).includes(value);
}
