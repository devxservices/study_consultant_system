ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'document_status';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'document_expiring';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'installment_due';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'payment_overdue';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'payment_submitted';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'payment_reviewed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'refund_requested';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'refund_decided';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'approval_needed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'commission_due';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'claim_follow_up';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'partner_applied';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'partner_update';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'payout_ready';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'attribution_conflict';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'course_update';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'absence_alert';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'homework_update';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'partner';--> statement-breakpoint
CREATE TABLE "staff_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"effects" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"takes_clients" boolean DEFAULT true NOT NULL,
	"system_key" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "email_notifications" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "staff_role_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "partner_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_roles_tenant_name_key" ON "staff_roles" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_staff_role_id_staff_roles_id_fk" FOREIGN KEY ("staff_role_id") REFERENCES "public"."staff_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_staff_role_idx" ON "users" USING btree ("staff_role_id");--> statement-breakpoint
CREATE INDEX "users_partner_idx" ON "users" USING btree ("partner_id");--> statement-breakpoint
-- Hand-written backfill: every existing consultancy gets the built-in roles
-- (generated from DEFAULT_ROLE_TEMPLATES in @crm/shared). Nobody is given
-- one - existing staff keep exactly the permissions they had.
-- Additive only. To undo: ALTER TABLE users DROP COLUMN staff_role_id,
-- DROP COLUMN partner_id; ALTER TABLE tenants DROP COLUMN email_notifications;
-- DROP TABLE staff_roles; (enum values cannot be removed, and are harmless).
INSERT INTO "staff_roles" ("tenant_id", "system_key", "name", "description", "effects", "takes_clients")
SELECT t."id", v.key, v.name, v.description, v.effects, v.takes_clients
FROM "tenants" t CROSS JOIN (VALUES
  ('counsellor', 'Counsellor', 'Works their own students from first call to visa. Uses the consultancy’s defaults.', '{}'::jsonb, true),
  ('senior', 'Senior consultant', 'Sees every student, reassigns them, and oversees the team.', '{"client.view_all":"allow","client.assign":"allow","staff.view":"allow","audit.view":"allow","data.export":"allow","document.share":"allow","workflow.manage":"allow","commission.view":"allow","partner.view":"allow"}'::jsonb, true),
  ('accountant', 'Accountant', 'Runs the money: invoices, verifying payments, refunds, expenses, the books and reports. No caseload.', '{"client.view_all":"allow","billing.view":"allow","billing.invoice":"allow","billing.payment":"allow","billing.verify":"allow","billing.refund":"allow","finance.expenses":"allow","finance.ledger":"allow","commission.view":"allow","commission.manage":"allow","payout.manage":"allow","partner.view":"allow","case.move":"deny","document.verify":"deny","document.reject":"deny","document.upload":"deny","chat.send":"deny","client.create":"deny","case.create":"deny"}'::jsonb, false),
  ('trainer', 'Trainer', 'Teaches IELTS, PTE and language batches: attendance, scores and homework. No caseload.', '{"course.view":"allow","course.teach":"allow","client.create":"deny","client.edit":"deny","case.create":"deny","case.edit":"deny","case.move":"deny","document.verify":"deny","document.reject":"deny","billing.view":"deny","billing.invoice":"deny","billing.payment":"deny","chat.send":"deny"}'::jsonb, false),
  ('partner_manager', 'Partner manager', 'Looks after sub-agents and referral partners, their students and their payouts.', '{"partner.view":"allow","partner.manage":"allow","commission.view":"allow","client.view_all":"allow"}'::jsonb, true)
) AS v(key, name, description, effects, takes_clients)
ON CONFLICT DO NOTHING;
