import { pgEnum } from 'drizzle-orm/pg-core';
import {
  CASE_STATUSES,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  ROLES,
  STAGES,
  TENANT_STATUSES,
  AUDIENCES,
  MFA_POLICIES,
  PERMISSION_EFFECTS,
  INVOICE_STATUSES,
  NOTIFICATION_TYPES,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  SUBSCRIPTION_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from '@crm/shared';

/** Drizzle needs a mutable tuple; the shared package owns the canonical values. */
const tuple = <T extends readonly string[]>(v: T) =>
  [...v] as unknown as [string, ...string[]];

export const roleEnum = pgEnum('role', tuple(ROLES));
export const stageEnum = pgEnum('stage', tuple(STAGES));
export const caseStatusEnum = pgEnum('case_status', tuple(CASE_STATUSES));
export const documentTypeEnum = pgEnum('document_type', tuple(DOCUMENT_TYPES));
export const documentStatusEnum = pgEnum('document_status', tuple(DOCUMENT_STATUSES));
export const tenantStatusEnum = pgEnum('tenant_status', tuple(TENANT_STATUSES));
export const stageChangeMethodEnum = pgEnum('stage_change_method', ['auto', 'manual', 'initial']);
export const notificationTypeEnum = pgEnum('notification_type', tuple(NOTIFICATION_TYPES));
export const subscriptionStatusEnum = pgEnum('subscription_status', tuple(SUBSCRIPTION_STATUSES));
export const invoiceStatusEnum = pgEnum('invoice_status', tuple(INVOICE_STATUSES));
export const paymentKindEnum = pgEnum('payment_kind', tuple(PAYMENT_KINDS));
export const paymentMethodEnum = pgEnum('payment_method', tuple(PAYMENT_METHODS));
export const taskPriorityEnum = pgEnum('task_priority', tuple(TASK_PRIORITIES));
export const taskStatusEnum = pgEnum('task_status', tuple(TASK_STATUSES));
export const audienceEnum = pgEnum('audience', tuple(AUDIENCES));
export const permissionEffectEnum = pgEnum('permission_effect', tuple(PERMISSION_EFFECTS));
export const mfaPolicyEnum = pgEnum('mfa_policy', tuple(MFA_POLICIES));
