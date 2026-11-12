-- Scale: what a page reads must not grow with the size of the consultancy.
-- 1. Trigram search (pg_trgm) for "contains" searches on clients.
-- 2. stats_cache: consultancy-wide figures, read back instead of recomputed.
-- 3. cases.stuck_at, kept by a trigger: "is it stuck?" becomes an index range.
-- 4. cases.last_message_at, kept by a trigger on messages: the inbox walks
--    the newest conversations instead of ranking all of them.
-- 5. Indexes for the invoice list's order and the unread badge.
-- 6. Every "newest first" index rebuilt as plain DESC (nulls first). They were
--    DESC NULLS LAST, which a query's ORDER BY ... DESC (nulls first) cannot
--    read in order, so every list scanned and sorted its whole table instead
--    of reading its first page from the index. The columns are NOT NULL or
--    filtered to non-null, so no result changes - only the plan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "stats_cache" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"marker_at" timestamp with time zone,
	"compute_ms" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "stats_cache_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "stuck_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "last_message_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stats_cache" ADD CONSTRAINT "stats_cache_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 3. stuck_at. Generated from STAGE_DEFINITIONS by analytics/stuck-thresholds.ts,
--    which also rewrites it at boot if those limits ever change. Named to run
--    after cases_fill_workflow (triggers fire in name order), which may have
--    just changed the stage and its limit.
CREATE OR REPLACE FUNCTION cases_set_stuck_at() RETURNS trigger AS $$
BEGIN
  NEW.stuck_at := NEW.stage_entered_at + coalesce(NEW.stage_sla_days * interval '1 day', (case NEW.current_stage when 'inquiry' then interval '7 days' when 'shortlisting' then interval '10 days' when 'documents_collection' then interval '14 days' when 'application_submitted' then interval '30 days' when 'offer_letter' then interval '14 days' when 'fee_payment' then interval '21 days' when 'visa_filed' then interval '21 days' when 'visa_interview' then interval '21 days' when 'visa_decision' then interval '30 days' when 'closed' then interval '3650 days' end));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
COMMENT ON FUNCTION cases_set_stuck_at() IS 'stuck-thresholds inquiry:7,shortlisting:10,documents_collection:14,application_submitted:30,offer_letter:14,fee_payment:21,visa_filed:21,visa_interview:21,visa_decision:30,closed:3650';--> statement-breakpoint
UPDATE "cases" c SET "stuck_at" = c.stage_entered_at + coalesce(c.stage_sla_days * interval '1 day', (case c.current_stage when 'inquiry' then interval '7 days' when 'shortlisting' then interval '10 days' when 'documents_collection' then interval '14 days' when 'application_submitted' then interval '30 days' when 'offer_letter' then interval '14 days' when 'fee_payment' then interval '21 days' when 'visa_filed' then interval '21 days' when 'visa_interview' then interval '21 days' when 'visa_decision' then interval '30 days' when 'closed' then interval '3650 days' end));--> statement-breakpoint
CREATE TRIGGER cases_set_stuck_at BEFORE INSERT OR UPDATE ON "cases"
  FOR EACH ROW EXECUTE FUNCTION cases_set_stuck_at();--> statement-breakpoint
-- 4. last_message_at. Messages are only ever added (reading one sets read_at,
--    nothing re-dates or removes one), so moving it forward on insert keeps it exact.
CREATE OR REPLACE FUNCTION messages_touch_case() RETURNS trigger AS $$
BEGIN
  UPDATE cases SET last_message_at = NEW.sent_at
  WHERE id = NEW.case_id AND (last_message_at IS NULL OR last_message_at < NEW.sent_at);
  RETURN NULL;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
UPDATE "cases" c SET "last_message_at" = m.last_at
FROM (SELECT case_id, max(sent_at) AS last_at FROM messages GROUP BY case_id) m
WHERE c.id = m.case_id;--> statement-breakpoint
CREATE TRIGGER messages_touch_case AFTER INSERT ON "messages"
  FOR EACH ROW EXECUTE FUNCTION messages_touch_case();--> statement-breakpoint
DROP INDEX "announcements_tenant_created_idx";--> statement-breakpoint
DROP INDEX "audit_tenant_actor_idx";--> statement-breakpoint
DROP INDEX "audit_case_idx";--> statement-breakpoint
DROP INDEX "audit_client_idx";--> statement-breakpoint
DROP INDEX "audit_actor_idx";--> statement-breakpoint
DROP INDEX "audit_tenant_created_idx";--> statement-breakpoint
DROP INDEX "automation_runs_tenant_created_idx";--> statement-breakpoint
DROP INDEX "automation_runs_rule_idx";--> statement-breakpoint
DROP INDEX "stage_events_case_idx";--> statement-breakpoint
DROP INDEX "cases_last_activity_idx";--> statement-breakpoint
DROP INDEX "clients_created_at_idx";--> statement-breakpoint
DROP INDEX "clients_tenant_created_idx";--> statement-breakpoint
DROP INDEX "documents_tenant_uploaded_idx";--> statement-breakpoint
DROP INDEX "messages_case_idx";--> statement-breakpoint
DROP INDEX "notifications_user_idx";--> statement-breakpoint
DROP INDEX "share_access_log_link_idx";--> statement-breakpoint
DROP INDEX "share_links_tenant_idx";--> statement-breakpoint
CREATE INDEX "cases_tenant_stuck_idx" ON "cases" USING btree ("tenant_id","stuck_at") WHERE status = 'active' AND current_stage <> 'closed';--> statement-breakpoint
CREATE INDEX "cases_consultant_stuck_idx" ON "cases" USING btree ("consultant_id","stuck_at") WHERE status = 'active' AND current_stage <> 'closed';--> statement-breakpoint
CREATE INDEX "cases_tenant_last_message_idx" ON "cases" USING btree ("tenant_id","last_message_at" DESC NULLS FIRST) WHERE last_message_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "cases_consultant_last_message_idx" ON "cases" USING btree ("consultant_id","last_message_at" DESC NULLS FIRST) WHERE last_message_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "clients_name_trgm_idx" ON "clients" USING gin ("full_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "clients_email_trgm_idx" ON "clients" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "clients_phone_trgm_idx" ON "clients" USING gin ("phone" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "invoices_tenant_issued_idx" ON "invoices" USING btree ("tenant_id","issue_date" DESC NULLS FIRST,"number" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "messages_tenant_unread_idx" ON "messages" USING btree ("tenant_id","case_id") WHERE read_at IS NULL;--> statement-breakpoint
CREATE INDEX "announcements_tenant_created_idx" ON "announcements" USING btree ("tenant_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_tenant_actor_idx" ON "audit_log" USING btree ("tenant_id","actor_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_case_idx" ON "audit_log" USING btree ("case_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_client_idx" ON "audit_log" USING btree ("client_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_tenant_created_idx" ON "audit_log" USING btree ("tenant_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "automation_runs_tenant_created_idx" ON "automation_runs" USING btree ("tenant_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "automation_runs_rule_idx" ON "automation_runs" USING btree ("rule_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "stage_events_case_idx" ON "case_stage_events" USING btree ("case_id","entered_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "cases_last_activity_idx" ON "cases" USING btree ("last_activity_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "clients_created_at_idx" ON "clients" USING btree ("created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "clients_tenant_created_idx" ON "clients" USING btree ("tenant_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "documents_tenant_uploaded_idx" ON "documents" USING btree ("tenant_id","uploaded_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "messages_case_idx" ON "messages" USING btree ("case_id","sent_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "share_access_log_link_idx" ON "share_access_log" USING btree ("share_link_id","at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "share_links_tenant_idx" ON "share_links" USING btree ("tenant_id","created_at" DESC NULLS FIRST);
