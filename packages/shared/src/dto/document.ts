import { z } from 'zod';
import { DOCUMENT_STATUSES, DOCUMENT_TYPES, type DocumentStatus } from '../documents';
import { dateOnlySchema } from '../profile';
import { uuidSchema } from './common';

/** Multipart upload: the file rides alongside, these are the text fields. */
export const uploadDocumentSchema = z.object({
  caseId: uuidSchema,
  type: z.enum(DOCUMENT_TYPES),
  /** Set when replacing a rejected document, so the two stay linked. */
  replacesId: uuidSchema.optional(),
  /** When it runs out - a passport, a test result. */
  expiresOn: dateOnlySchema.optional(),
});
export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;

/**
 * A rejection without a reason is useless to the client - they would have to
 * message and ask what was wrong, which is the exact problem this product
 * exists to remove. So the reason is required, and long enough to be a
 * sentence rather than "no".
 */
export const rejectDocumentSchema = z.object({
  comment: z
    .string()
    .trim()
    .min(10, 'Tell the client what to fix, in a full sentence.')
    .max(500),
});
export type RejectDocumentInput = z.infer<typeof rejectDocumentSchema>;

export const commentDocumentSchema = z.object({
  body: z.string().trim().min(2, 'Write a message.').max(500),
});
export type CommentDocumentInput = z.infer<typeof commentDocumentSchema>;

export const listDocumentsQuerySchema = z.object({
  caseId: uuidSchema.optional(),
  clientId: uuidSchema.optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  /** Waiting on staff: uploaded or under review - the review queue. */
  awaiting: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  type: z.enum(DOCUMENT_TYPES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  /** Oldest-waiting first is the right default for a review queue. */
  sort: z.enum(['oldest', 'newest']).default('oldest'),
});
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;

export interface DocumentComment {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
}

export interface DocumentView {
  id: string;
  /** Null for a document that belongs to the student rather than one application. */
  caseId: string | null;
  /** Null only for the agency's own files, which no student ever sees. */
  clientId: string | null;
  clientName: string | null;
  caseReference: string | null;
  type: string;
  /** The type the consultancy filed it as - a built-in type, or one of its own. */
  typeKey: string;
  folderId: string | null;
  expiresOn: string | null;
  fileName: string;
  fileSize: number;
  mimeType: string;
  status: DocumentStatus;
  uploadedAt: string;
  uploadedById: string;
  uploadedByName: string;
  uploadedByRole: string;
  reviewerComment: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  supersededById: string | null;
  /** URL to fetch the file itself; always goes through an authorised route. */
  downloadUrl: string;
  /** Whether the person asking is allowed to delete it. */
  canDelete: boolean;
  comments: DocumentComment[];
}
