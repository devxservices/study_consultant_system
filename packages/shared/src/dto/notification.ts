import { z } from 'zod';

export const NOTIFICATION_TYPES = [
  'document_verified',
  'document_rejected',
  'document_commented',
  'document_uploaded',
  'stage_changed',
  'message_received',
  'client_assigned',
  'case_stuck',
  'task_assigned',
  'task_overdue',
  'invoice_issued',
  'payment_received',
  'announcement',
  // Documents
  'document_status',
  'document_expiring',
  // Money
  'installment_due',
  'payment_overdue',
  'payment_submitted',
  'payment_reviewed',
  'refund_requested',
  'refund_decided',
  'approval_needed',
  // Commissions
  'commission_due',
  'claim_follow_up',
  // Partners
  'partner_applied',
  'partner_update',
  'payout_ready',
  'attribution_conflict',
  // Courses
  'course_update',
  'absence_alert',
  'homework_update',
  // Workflows
  'workflow_alert',
] as const;

export const emailNotificationsSchema = z.object({
  settings: z.record(z.enum(NOTIFICATION_TYPES), z.boolean()),
});
export type EmailNotificationsInput = z.infer<typeof emailNotificationsSchema>;

/** What each type is called where people switch its emails on or off. */
export const NOTIFICATION_TYPE_LABEL: Record<(typeof NOTIFICATION_TYPES)[number], string> = {
  document_verified: 'A document is approved',
  document_rejected: 'A document is rejected',
  document_commented: 'A question about a document',
  document_uploaded: 'A document is uploaded',
  stage_changed: 'An application moves stage',
  message_received: 'A new message',
  client_assigned: 'A client is assigned',
  case_stuck: 'An application stops moving',
  task_assigned: 'A task is assigned',
  task_overdue: 'A task is overdue',
  invoice_issued: 'An invoice is issued',
  payment_received: 'A payment is received (with the receipt)',
  announcement: 'An announcement',
  document_status: 'A document’s review status changes',
  document_expiring: 'A passport, test or visa is about to expire',
  installment_due: 'An installment is due',
  payment_overdue: 'A payment is overdue',
  payment_submitted: 'A client sends proof of payment',
  payment_reviewed: 'Proof of payment is approved or rejected',
  refund_requested: 'A refund needs approval',
  refund_decided: 'A refund is approved or rejected',
  approval_needed: 'Something needs a second approval',
  commission_due: 'A university commission becomes due',
  claim_follow_up: 'A commission claim needs following up',
  partner_applied: 'A partner applies',
  partner_update: 'News for a partner about their students',
  payout_ready: 'A partner payout is ready',
  attribution_conflict: 'A student is registered twice',
  course_update: 'Course enrolment and results',
  absence_alert: 'A student keeps missing class',
  homework_update: 'Homework is set or graded',
  workflow_alert: 'A workflow automation flags something',
};
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  /** In-app deep link. Always internal - never an external URL. */
  link: string | null;
  caseId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationFeed {
  items: NotificationView[];
  unread: number;
}

/**
 * Which of the three status colours a notification carries, if any.
 * Anything that is not genuinely good or bad stays neutral - a bell full of
 * colour teaches people to ignore the colour.
 */
export const NOTIFICATION_TONE: Record<NotificationType, 'ok' | 'warn' | 'bad' | 'neutral'> = {
  document_verified: 'ok',
  document_rejected: 'bad',
  document_commented: 'neutral',
  document_uploaded: 'warn',
  stage_changed: 'ok',
  message_received: 'neutral',
  client_assigned: 'neutral',
  case_stuck: 'bad',
  task_assigned: 'neutral',
  task_overdue: 'warn',
  invoice_issued: 'neutral',
  payment_received: 'ok',
  announcement: 'neutral',
  document_status: 'neutral',
  document_expiring: 'warn',
  installment_due: 'warn',
  payment_overdue: 'bad',
  payment_submitted: 'warn',
  payment_reviewed: 'neutral',
  refund_requested: 'warn',
  refund_decided: 'neutral',
  approval_needed: 'warn',
  commission_due: 'neutral',
  claim_follow_up: 'warn',
  partner_applied: 'warn',
  partner_update: 'neutral',
  payout_ready: 'ok',
  attribution_conflict: 'warn',
  course_update: 'neutral',
  absence_alert: 'warn',
  homework_update: 'neutral',
  workflow_alert: 'warn',
};

/** Socket.IO events for the notification stream. */
export const NOTIFICATION_EVENTS = {
  created: 'notification:created',
  readAll: 'notification:read-all',
} as const;
