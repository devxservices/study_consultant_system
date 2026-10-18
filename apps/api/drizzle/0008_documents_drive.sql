ALTER TYPE "public"."document_status" ADD VALUE IF NOT EXISTS 'under_review';--> statement-breakpoint
ALTER TYPE "public"."document_status" ADD VALUE IF NOT EXISTS 'reupload_requested';--> statement-breakpoint
CREATE TABLE "doc_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid,
	"parent_id" uuid,
	"name" text NOT NULL,
	"system_key" text,
	"color" text,
	"restricted" boolean DEFAULT false NOT NULL,
	"shared_with_partners" boolean DEFAULT false NOT NULL,
	"ancestry" text DEFAULT '/' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trashed_at" timestamp with time zone,
	"trashed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "document_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"hint" text,
	"folder_key" text DEFAULT 'other' NOT NULL,
	"has_expiry" boolean DEFAULT false NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"accepted_types" jsonb NOT NULL,
	"max_file_mb" integer DEFAULT 15 NOT NULL,
	"rename_pattern" text DEFAULT '{student}_{type}' NOT NULL,
	"retention_days" integer DEFAULT 30 NOT NULL,
	"expiry_reminder_days" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_stars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"item_type" text NOT NULL,
	"item_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folder_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"folders" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirement_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"study_level" text,
	"visa_type" text,
	"items" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"access" text DEFAULT 'view' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"share_link_id" uuid NOT NULL,
	"document_id" uuid,
	"action" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"document_id" uuid,
	"folder_id" uuid,
	"label" text NOT NULL,
	"password_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"view_only" boolean DEFAULT false NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"views" integer DEFAULT 0 NOT NULL,
	"last_access_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"fields" jsonb NOT NULL,
	"file_name" text NOT NULL,
	"size" bigint NOT NULL,
	"received" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "case_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "study_level" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "visa_type" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "type_key" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "version_group" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "expires_on" date;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "issued_on" date;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "expiry_notified_days" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "duplicate_of" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "trashed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "trashed_by" uuid;--> statement-breakpoint
ALTER TABLE "doc_folders" ADD CONSTRAINT "doc_folders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_folders" ADD CONSTRAINT "doc_folders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_folders" ADD CONSTRAINT "doc_folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_folders" ADD CONSTRAINT "doc_folders_trashed_by_users_id_fk" FOREIGN KEY ("trashed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_settings" ADD CONSTRAINT "drive_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_settings" ADD CONSTRAINT "drive_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_stars" ADD CONSTRAINT "drive_stars_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_stars" ADD CONSTRAINT "drive_stars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_templates" ADD CONSTRAINT "folder_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_sets" ADD CONSTRAINT "requirement_sets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_grants" ADD CONSTRAINT "resource_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_grants" ADD CONSTRAINT "resource_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_grants" ADD CONSTRAINT "resource_grants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_access_log" ADD CONSTRAINT "share_access_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_access_log" ADD CONSTRAINT "share_access_log_share_link_id_share_links_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_folder_id_doc_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."doc_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_folders_tenant_client_parent_idx" ON "doc_folders" USING btree ("tenant_id","client_id","parent_id");--> statement-breakpoint
CREATE INDEX "doc_folders_parent_idx" ON "doc_folders" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_folders_client_system_key" ON "doc_folders" USING btree ("client_id","system_key") WHERE client_id IS NOT NULL AND system_key IS NOT NULL AND trashed_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "document_types_tenant_key" ON "document_types" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "drive_stars_key" ON "drive_stars" USING btree ("user_id","item_type","item_id");--> statement-breakpoint
CREATE INDEX "folder_templates_tenant_idx" ON "folder_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "requirement_sets_tenant_idx" ON "requirement_sets" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_grants_key" ON "resource_grants" USING btree ("resource_type","resource_id","user_id");--> statement-breakpoint
CREATE INDEX "resource_grants_user_idx" ON "resource_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "share_access_log_link_idx" ON "share_access_log" USING btree ("share_link_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_token_key" ON "share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "share_links_document_idx" ON "share_links" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "share_links_folder_idx" ON "share_links" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "share_links_tenant_idx" ON "share_links" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "upload_sessions_user_idx" ON "upload_sessions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_id_doc_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."doc_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_trashed_by_users_id_fk" FOREIGN KEY ("trashed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_client_folder_idx" ON "documents" USING btree ("tenant_id","client_id","folder_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "documents_expiry_idx" ON "documents" USING btree ("tenant_id","expires_on") WHERE expires_on IS NOT NULL AND deleted_at IS NULL AND trashed_at IS NULL;--> statement-breakpoint
CREATE INDEX "documents_version_group_idx" ON "documents" USING btree ("version_group");--> statement-breakpoint
CREATE INDEX "documents_client_checksum_idx" ON "documents" USING btree ("client_id","checksum");--> statement-breakpoint
CREATE INDEX "documents_tenant_uploaded_idx" ON "documents" USING btree ("tenant_id","uploaded_at" DESC NULLS LAST);--> statement-breakpoint
-- Hand-written backfill. Additive only; to undo, drop the new tables and
-- columns (documents.case_id can be made NOT NULL again only while every
-- document still has an application, which is true until the drive is used).
--
-- 1. Every existing document keeps its type, now also as type_key.
UPDATE "documents" SET "type_key" = "type"::text;--> statement-breakpoint
-- 2. Re-upload chains (superseded_by) become version history: the first
--    upload is version 1 and every replacement counts up from it.
WITH RECURSIVE chain AS (
  SELECT d."id", d."id" AS root, 1 AS v
  FROM "documents" d
  WHERE NOT EXISTS (SELECT 1 FROM "documents" p WHERE p."superseded_by" = d."id")
  UNION ALL
  SELECT d."id", c.root, c.v + 1
  FROM "documents" d
  JOIN "documents" p ON p."superseded_by" = d."id"
  JOIN chain c ON c."id" = p."id"
)
UPDATE "documents" SET "version_group" = chain.root, "version" = chain.v
FROM chain WHERE "documents"."id" = chain."id";--> statement-breakpoint
UPDATE "documents" SET "version_group" = "id" WHERE "version_group" IS NULL;--> statement-breakpoint
-- 3. Every consultancy gets the built-in document types (generated from
--    DOCUMENT_META and EXTRA_SYSTEM_TYPES in @crm/shared).
INSERT INTO "document_types" ("tenant_id", "key", "label", "hint", "folder_key", "has_expiry", "system")
SELECT t."id", v.key, v.label, v.hint, v.folder_key, v.has_expiry, true
FROM "tenants" t CROSS JOIN (VALUES
  ('passport', 'Passport', 'Photo page only. Must be valid for at least 6 more months.', 'passport', true),
  ('cnic', 'CNIC / National ID', 'Front and back, in one file if possible.', 'passport', false),
  ('photograph', 'Passport-size Photograph', 'White background, taken within the last 6 months.', 'passport', false),
  ('transcript', 'Academic Transcript', 'Marksheets for your most recent qualification, all semesters/years.', 'academic', false),
  ('degree_certificate', 'Degree / Certificate', 'Your final degree or matric/intermediate certificate.', 'academic', false),
  ('language_test', 'Language Test Result', 'IELTS, PTE, TOEFL or Duolingo score report.', 'language', true),
  ('bank_statement', 'Bank Statement', 'Last 6 months, stamped by the bank.', 'financial', true),
  ('sponsor_affidavit', 'Sponsor Affidavit', 'Signed affidavit of financial support from your sponsor.', 'financial', false),
  ('sop', 'Statement of Purpose', 'Why you chose this course and country. Your consultant can help you draft it.', 'application', false),
  ('recommendation_letter', 'Recommendation Letter', 'From a teacher or employer, on official letterhead.', 'application', false),
  ('cv', 'CV / Resume', 'One or two pages, education and any work experience.', 'application', false),
  ('experience_letter', 'Experience Letter', 'Only if you have work experience to show.', 'application', false),
  ('offer_letter', 'Offer Letter', 'The admission letter sent to you by the university.', 'offers', false),
  ('fee_receipt', 'Tuition Fee Receipt', 'Proof that the deposit has been paid.', 'financial', false),
  ('i20_cas', 'I-20 / CAS / CoE', 'The enrolment confirmation the university issues after your fee payment.', 'offers', false),
  ('visa_form', 'Visa Application Form', 'The completed and signed application form.', 'visa', false),
  ('police_clearance', 'Police Clearance', 'Character certificate from the police.', 'visa', true),
  ('medical_report', 'Medical Report', 'From a panel-approved clinic only.', 'visa', true),
  ('other', 'Other Document', 'Anything else your consultant has asked you for.', 'other', false),
  ('visa_grant', 'Visa grant', 'The visa itself, or the grant letter.', 'visa', true),
  ('payment_proof', 'Proof of payment', 'A bank slip or screenshot of a transfer.', 'financial', false),
  ('agreement', 'Signed agreement', 'An agreement signed with the consultancy.', 'other', false)
) AS v(key, label, hint, folder_key, has_expiry)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- 4. A default folder template and a general checklist (what the Documents
--    Collection stage has always required), per consultancy.
INSERT INTO "folder_templates" ("tenant_id", "name", "folders", "is_default")
SELECT "id", 'Standard student folders', '[{"key":"passport","name":"Passport and ID"},{"key":"academic","name":"Academic"},{"key":"language","name":"Language tests"},{"key":"financial","name":"Financial"},{"key":"application","name":"Application documents"},{"key":"offers","name":"Offer letters"},{"key":"visa","name":"Visa"},{"key":"other","name":"Other"}]'::jsonb, true FROM "tenants";--> statement-breakpoint
INSERT INTO "requirement_sets" ("tenant_id", "name", "items")
SELECT "id", 'General checklist', '[{"typeKey":"passport","required":true},{"typeKey":"cnic","required":true},{"typeKey":"transcript","required":true},{"typeKey":"language_test","required":true},{"typeKey":"bank_statement","required":true},{"typeKey":"sop","required":true}]'::jsonb FROM "tenants";
--> statement-breakpoint
-- Code that inserts a document the original way (type only - the seeds, a
-- script) still gets a matching type_key and its own version group, so it is
-- filed, named and versioned like any upload.
CREATE OR REPLACE FUNCTION documents_fill_defaults() RETURNS trigger AS $$
BEGIN
  IF NEW.type_key IS NULL OR (NEW.type_key = 'other' AND NEW.type::text <> 'other') THEN
    NEW.type_key := NEW.type::text;
  END IF;
  IF NEW.version_group IS NULL THEN
    NEW.version_group := NEW.id;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER documents_fill_defaults BEFORE INSERT ON "documents"
  FOR EACH ROW EXECUTE FUNCTION documents_fill_defaults();
