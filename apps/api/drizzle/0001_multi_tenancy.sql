CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended', 'deactivated');--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'super_admin';--> statement-breakpoint
CREATE TABLE "tenant_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"verification_token" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "tenant_status" DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"status_changed_at" timestamp with time zone,
	"primary_color" text,
	"logo_key" text,
	"contact_email" text,
	"contact_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "cases_reference_key";--> statement-breakpoint
DROP INDEX "users_email_key";--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "case_stage_events" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "consultants" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "document_comments" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
-- Hand-written backfill. Everything that existed before tenancy belonged to a
-- single consultancy, so it all moves into one tenant, "main" - the slug the
-- bare development host resolves to (DEFAULT_TENANT_SLUG). An empty database
-- gets no tenant at all; the first one is created through onboarding.
INSERT INTO "tenants" ("slug", "name")
  SELECT 'main', 'Main consultancy' WHERE EXISTS (SELECT 1 FROM "users");--> statement-breakpoint
UPDATE "users" SET "tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'main');--> statement-breakpoint
UPDATE "consultants" SET "tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'main');--> statement-breakpoint
UPDATE "clients" SET "tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'main');--> statement-breakpoint
UPDATE "cases" SET "tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'main');--> statement-breakpoint
UPDATE "case_stage_events" SET "tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'main');--> statement-breakpoint
UPDATE "documents" SET "tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'main');--> statement-breakpoint
UPDATE "document_comments" SET "tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'main');--> statement-breakpoint
UPDATE "messages" SET "tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'main');--> statement-breakpoint
UPDATE "notifications" SET "tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'main');--> statement-breakpoint
UPDATE "audit_log" SET "tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'main');--> statement-breakpoint
ALTER TABLE "case_stage_events" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "consultants" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "document_comments" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_domains_hostname_key" ON "tenant_domains" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "tenant_domains_tenant_idx" ON "tenant_domains" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_stage_events" ADD CONSTRAINT "case_stage_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultants" ADD CONSTRAINT "consultants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_tenant_created_idx" ON "audit_log" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "cases_tenant_reference_key" ON "cases" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX "cases_tenant_status_idx" ON "cases" USING btree ("tenant_id","status","current_stage");--> statement-breakpoint
CREATE INDEX "cases_tenant_created_idx" ON "cases" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "clients_tenant_created_idx" ON "clients" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "clients_tenant_consultant_idx" ON "clients" USING btree ("tenant_id","assigned_consultant_id");--> statement-breakpoint
CREATE INDEX "consultants_tenant_idx" ON "consultants" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "documents_tenant_status_idx" ON "documents" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_email_key" ON "users" USING btree ("tenant_id",lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_platform_email_key" ON "users" USING btree (lower("email")) WHERE tenant_id IS NULL;--> statement-breakpoint
CREATE INDEX "users_tenant_role_idx" ON "users" USING btree ("tenant_id","role");