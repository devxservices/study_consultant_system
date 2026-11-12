-- Undo 0017_scale. Nothing here holds data that exists nowhere else:
-- stats_cache is recomputed on demand, stuck_at and last_message_at are
-- derived from stage_entered_at and messages. The pg_trgm extension is left
-- installed; it is harmless and other objects may use it.
DROP INDEX IF EXISTS "messages_tenant_unread_idx";
DROP INDEX IF EXISTS "invoices_tenant_issued_idx";
DROP INDEX IF EXISTS "clients_phone_trgm_idx";
DROP INDEX IF EXISTS "clients_email_trgm_idx";
DROP INDEX IF EXISTS "clients_name_trgm_idx";
DROP INDEX IF EXISTS "cases_consultant_last_message_idx";
DROP INDEX IF EXISTS "cases_tenant_last_message_idx";
DROP INDEX IF EXISTS "cases_consultant_stuck_idx";
DROP INDEX IF EXISTS "cases_tenant_stuck_idx";
DROP TRIGGER IF EXISTS messages_touch_case ON "messages";
DROP FUNCTION IF EXISTS messages_touch_case();
DROP TRIGGER IF EXISTS cases_set_stuck_at ON "cases";
DROP FUNCTION IF EXISTS cases_set_stuck_at();
ALTER TABLE "cases" DROP COLUMN IF EXISTS "last_message_at";
ALTER TABLE "cases" DROP COLUMN IF EXISTS "stuck_at";
DROP TABLE IF EXISTS "stats_cache";
-- The "newest first" indexes, back to how 0016 left them (DESC NULLS LAST).
DROP INDEX IF EXISTS "announcements_tenant_created_idx";
DROP INDEX IF EXISTS "audit_tenant_actor_idx";
DROP INDEX IF EXISTS "audit_case_idx";
DROP INDEX IF EXISTS "audit_client_idx";
DROP INDEX IF EXISTS "audit_actor_idx";
DROP INDEX IF EXISTS "audit_tenant_created_idx";
DROP INDEX IF EXISTS "automation_runs_tenant_created_idx";
DROP INDEX IF EXISTS "automation_runs_rule_idx";
DROP INDEX IF EXISTS "stage_events_case_idx";
DROP INDEX IF EXISTS "cases_last_activity_idx";
DROP INDEX IF EXISTS "clients_created_at_idx";
DROP INDEX IF EXISTS "clients_tenant_created_idx";
DROP INDEX IF EXISTS "documents_tenant_uploaded_idx";
DROP INDEX IF EXISTS "messages_case_idx";
DROP INDEX IF EXISTS "notifications_user_idx";
DROP INDEX IF EXISTS "share_access_log_link_idx";
DROP INDEX IF EXISTS "share_links_tenant_idx";
CREATE INDEX "announcements_tenant_created_idx" ON "announcements" USING btree ("tenant_id","created_at" DESC NULLS LAST);
CREATE INDEX "audit_tenant_actor_idx" ON "audit_log" USING btree ("tenant_id","actor_id","created_at" DESC NULLS LAST);
CREATE INDEX "audit_case_idx" ON "audit_log" USING btree ("case_id","created_at" DESC NULLS LAST);
CREATE INDEX "audit_client_idx" ON "audit_log" USING btree ("client_id","created_at" DESC NULLS LAST);
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_id","created_at" DESC NULLS LAST);
CREATE INDEX "audit_tenant_created_idx" ON "audit_log" USING btree ("tenant_id","created_at" DESC NULLS LAST);
CREATE INDEX "automation_runs_tenant_created_idx" ON "automation_runs" USING btree ("tenant_id","created_at" DESC NULLS LAST);
CREATE INDEX "automation_runs_rule_idx" ON "automation_runs" USING btree ("rule_id","created_at" DESC NULLS LAST);
CREATE INDEX "stage_events_case_idx" ON "case_stage_events" USING btree ("case_id","entered_at" DESC NULLS LAST);
CREATE INDEX "cases_last_activity_idx" ON "cases" USING btree ("last_activity_at" DESC NULLS LAST);
CREATE INDEX "clients_created_at_idx" ON "clients" USING btree ("created_at" DESC NULLS LAST);
CREATE INDEX "clients_tenant_created_idx" ON "clients" USING btree ("tenant_id","created_at" DESC NULLS LAST);
CREATE INDEX "documents_tenant_uploaded_idx" ON "documents" USING btree ("tenant_id","uploaded_at" DESC NULLS LAST);
CREATE INDEX "messages_case_idx" ON "messages" USING btree ("case_id","sent_at" DESC NULLS LAST);
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);
CREATE INDEX "share_access_log_link_idx" ON "share_access_log" USING btree ("share_link_id","at" DESC NULLS LAST);
CREATE INDEX "share_links_tenant_idx" ON "share_links" USING btree ("tenant_id","created_at" DESC NULLS LAST);
