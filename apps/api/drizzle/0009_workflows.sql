ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'workflow_alert';--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger" text NOT NULL,
	"workflow_id" uuid,
	"stage_key" text,
	"document_type" text,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_id" uuid,
	"stage_key" text,
	"case_id" uuid,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"event_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"currency" text NOT NULL,
	"intakes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proof_of_funds" jsonb,
	"language_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visa_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visa_processing_days" integer,
	"work_rights" text,
	"post_study_work" text,
	"notes" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"client_label" text NOT NULL,
	"client_description" text DEFAULT '' NOT NULL,
	"category" "stage" NOT NULL,
	"color" text DEFAULT 'blue' NOT NULL,
	"sla_days" integer NOT NULL,
	"required_documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auto_advance" boolean DEFAULT true NOT NULL,
	"approval_required" boolean DEFAULT false NOT NULL,
	"movable_by" text DEFAULT 'staff' NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tasks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notify_student" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"country" text,
	"study_level" text,
	"visa_type" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_stage_events" ADD COLUMN "stage_key" text;--> statement-breakpoint
ALTER TABLE "case_stage_events" ADD COLUMN "workflow_version_id" uuid;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "workflow_version_id" uuid;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "current_stage_key" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "current_stage_name" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "stage_sla_days" integer;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "stage_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "stage_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_workflow_id_workflow_templates_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "countries" ADD CONSTRAINT "countries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "countries" ADD CONSTRAINT "countries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_version_id_workflow_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_template_id_workflow_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_rules_tenant_trigger_idx" ON "automation_rules" USING btree ("tenant_id","trigger") WHERE deleted_at is null and enabled;--> statement-breakpoint
CREATE INDEX "automation_runs_tenant_created_idx" ON "automation_runs" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "automation_runs_rule_idx" ON "automation_runs" USING btree ("rule_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_event_key" ON "automation_runs" USING btree ("tenant_id","event_key") WHERE event_key is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "countries_tenant_name_key" ON "countries" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_stages_version_key" ON "workflow_stages" USING btree ("version_id","key");--> statement-breakpoint
CREATE INDEX "workflow_stages_version_position_idx" ON "workflow_stages" USING btree ("version_id","position");--> statement-breakpoint
CREATE INDEX "workflow_templates_tenant_idx" ON "workflow_templates" USING btree ("tenant_id","country");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_templates_default_key" ON "workflow_templates" USING btree ("tenant_id") WHERE is_default;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_templates_tenant_name_key" ON "workflow_templates" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_template_version_key" ON "workflow_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_one_draft_key" ON "workflow_versions" USING btree ("template_id") WHERE status = 'draft';--> statement-breakpoint
CREATE INDEX "workflow_versions_tenant_idx" ON "workflow_versions" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "case_stage_events" ADD CONSTRAINT "case_stage_events_workflow_version_id_workflow_versions_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_workflow_version_id_workflow_versions_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_stage_approved_by_users_id_fk" FOREIGN KEY ("stage_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cases_workflow_stage_idx" ON "cases" USING btree ("workflow_version_id","current_stage_key");
--> statement-breakpoint
-- Hand-written backfill. Additive only: nothing existing is changed except
-- the new columns being filled. To undo, run drizzle/rollback/0009_workflows.down.sql.
--
-- 1. A "Standard" workflow per consultancy - exactly the ten stages, limits,
--    required documents and the US-only interview the pipeline has always had.
INSERT INTO "workflow_templates" ("tenant_id", "name", "description", "is_default")
SELECT "id", 'Standard', 'The ten stages every application has used so far. Applications use it when no other workflow fits.', true
FROM "tenants";--> statement-breakpoint
INSERT INTO "workflow_versions" ("tenant_id", "template_id", "version", "status", "notes", "published_at")
SELECT "tenant_id", "id", 1, 'published', 'The pipeline as it was before workflows.', now()
FROM "workflow_templates" WHERE "is_default";--> statement-breakpoint
INSERT INTO "workflow_stages" ("tenant_id", "version_id", "key", "position", "name", "client_label", "client_description",
  "category", "color", "sla_days", "required_documents", "conditions")
SELECT v."tenant_id", v."id", s.key, s.position, s.name, s.client_label, s.client_description,
  s.key::"stage", s.color, s.sla_days, s.required_documents::jsonb, s.conditions::jsonb
FROM "workflow_versions" v
CROSS JOIN (VALUES
  ('inquiry', 0, 'Inquiry / Consultation', 'Getting started', 'We are learning about your goals and budget to advise you properly.', 'slate', 7, '[]', '[]'),
  ('shortlisting', 1, 'University Shortlisting', 'Choosing your universities', 'Your consultant is picking courses and universities that fit your profile.', 'blue', 10, '[]', '[]'),
  ('documents_collection', 2, 'Documents Collection', 'Collecting your documents', 'Upload each document below. We check every one and tell you if anything needs fixing.', 'violet', 14, '["passport","cnic","transcript","language_test","bank_statement","sop"]', '[]'),
  ('application_submitted', 3, 'Application Submitted', 'Application sent to the university', 'Your application is with the university. Waiting on their decision.', 'blue', 30, '[]', '[]'),
  ('offer_letter', 4, 'Offer Letter Received', 'Offer letter received', 'The university has offered you a place. Congratulations.', 'teal', 14, '["offer_letter"]', '[]'),
  ('fee_payment', 5, 'Fee Payment / I-20 or CAS Issued', 'Paying the deposit', 'Pay the tuition deposit so the university can issue your enrolment document.', 'amber', 21, '["fee_receipt","i20_cas"]', '[]'),
  ('visa_filed', 6, 'Visa Application Filed', 'Visa application filed', 'Your visa application has been submitted to the embassy.', 'orange', 21, '["visa_form"]', '[]'),
  ('visa_interview', 7, 'Visa Interview', 'Visa interview', 'Attend your embassy interview. Your consultant will prepare you beforehand.', 'orange', 21, '[]', '[{"field":"targetCountry","op":"in","value":["United States"]}]'),
  ('visa_decision', 8, 'Visa Decision', 'Visa decision', 'The embassy is deciding on your visa.', 'rose', 30, '[]', '[]'),
  ('closed', 9, 'Case Closed / Departure', 'All done', 'Your case is complete. We wish you the very best.', 'green', 3650, '[]', '[]')
) AS s(key, position, name, client_label, client_description, color, sla_days, required_documents, conditions);--> statement-breakpoint
-- 2. Every application onto it, at the stage it is at; its history too.
UPDATE "cases" c
SET "workflow_version_id" = s."version_id", "current_stage_key" = s."key",
    "current_stage_name" = s."name", "stage_sla_days" = s."sla_days"
FROM "workflow_stages" s
JOIN "workflow_versions" v ON v."id" = s."version_id"
WHERE v."tenant_id" = c."tenant_id" AND s."key" = c."current_stage"::text;--> statement-breakpoint
UPDATE "case_stage_events" e
SET "stage_key" = e."stage"::text, "workflow_version_id" = c."workflow_version_id"
FROM "cases" c WHERE c."id" = e."case_id";--> statement-breakpoint
-- 3. Senior consultants (the seeded role) may approve gated stages.
UPDATE "staff_roles" SET "effects" = "effects" || '{"case.approve":"allow"}'::jsonb
WHERE "system_key" = 'senior' AND NOT ("effects" ? 'case.approve');--> statement-breakpoint
-- 4. Code that writes an application the original way - stage enum only:
--    the seeds, scripts, older tests - still gets a workflow, a stage key,
--    and a name and limit that match. And the name, limit and category
--    always follow the stage key, so they cannot disagree.
CREATE OR REPLACE FUNCTION cases_fill_workflow() RETURNS trigger AS $$
DECLARE
  st record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.workflow_version_id IS NULL THEN
      SELECT v.id INTO NEW.workflow_version_id
      FROM workflow_versions v JOIN workflow_templates t ON t.id = v.template_id
      WHERE t.tenant_id = NEW.tenant_id AND t.is_default AND v.status = 'published'
      ORDER BY v.version DESC LIMIT 1;
    END IF;
    IF NEW.workflow_version_id IS NOT NULL AND NEW.current_stage_key IS NULL THEN
      SELECT key INTO NEW.current_stage_key FROM workflow_stages
      WHERE version_id = NEW.workflow_version_id AND category = NEW.current_stage
      ORDER BY position LIMIT 1;
    END IF;
  ELSIF NEW.current_stage IS DISTINCT FROM OLD.current_stage
    AND NEW.current_stage_key IS NOT DISTINCT FROM OLD.current_stage_key THEN
    -- Moved by category only: land on the first stage of that category.
    SELECT key INTO NEW.current_stage_key FROM workflow_stages
    WHERE version_id = NEW.workflow_version_id AND category = NEW.current_stage
    ORDER BY position LIMIT 1;
  END IF;
  IF NEW.workflow_version_id IS NOT NULL AND NEW.current_stage_key IS NOT NULL AND (
    TG_OP = 'INSERT'
    OR NEW.current_stage_key IS DISTINCT FROM OLD.current_stage_key
    OR NEW.workflow_version_id IS DISTINCT FROM OLD.workflow_version_id
  ) THEN
    SELECT name, sla_days, category INTO st FROM workflow_stages
    WHERE version_id = NEW.workflow_version_id AND key = NEW.current_stage_key;
    IF FOUND THEN
      NEW.current_stage_name := st.name;
      NEW.stage_sla_days := st.sla_days;
      NEW.current_stage := st.category;
    END IF;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER cases_fill_workflow BEFORE INSERT OR UPDATE ON "cases"
  FOR EACH ROW EXECUTE FUNCTION cases_fill_workflow();--> statement-breakpoint
CREATE OR REPLACE FUNCTION stage_events_fill_workflow() RETURNS trigger AS $$
BEGIN
  IF NEW.workflow_version_id IS NULL THEN
    SELECT workflow_version_id INTO NEW.workflow_version_id FROM cases WHERE id = NEW.case_id;
  END IF;
  IF NEW.stage_key IS NULL THEN
    SELECT key INTO NEW.stage_key FROM workflow_stages
    WHERE version_id = NEW.workflow_version_id AND category = NEW.stage
    ORDER BY position LIMIT 1;
    NEW.stage_key := COALESCE(NEW.stage_key, NEW.stage::text);
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER stage_events_fill_workflow BEFORE INSERT ON "case_stage_events"
  FOR EACH ROW EXECUTE FUNCTION stage_events_fill_workflow();--> statement-breakpoint
-- 5. A published version is never edited: its stages are what running
--    applications were promised. (A version being deleted - a discarded
--    draft - is no longer found, and its stages go with it.)
CREATE OR REPLACE FUNCTION workflow_stages_guard() RETURNS trigger AS $$
DECLARE
  st text;
BEGIN
  SELECT status INTO st FROM workflow_versions WHERE id = COALESCE(NEW.version_id, OLD.version_id);
  IF st IS NOT NULL AND st <> 'draft' THEN
    RAISE EXCEPTION 'Workflow version % is published; its stages cannot change.', COALESCE(NEW.version_id, OLD.version_id)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER workflow_stages_guard BEFORE INSERT OR UPDATE OR DELETE ON "workflow_stages"
  FOR EACH ROW EXECUTE FUNCTION workflow_stages_guard();
