ALTER TYPE "public"."audience" ADD VALUE IF NOT EXISTS 'partners';--> statement-breakpoint
CREATE TABLE "advance_recoveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"advance_id" uuid NOT NULL,
	"payout_id" uuid NOT NULL,
	"amount" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"current_partner_id" uuid,
	"claimant_partner_id" uuid NOT NULL,
	"claimed_by" uuid,
	"matched_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_advances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"recovered" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"given_on" date NOT NULL,
	"account_id" uuid,
	"fx_rate" numeric(18, 8),
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text
);
--> statement-breakpoint
CREATE TABLE "partner_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"document_hash" text,
	"sent_at" timestamp with time zone,
	"sent_by" uuid,
	"signed_at" timestamp with time zone,
	"signed_by" uuid,
	"signer_name" text,
	"signer_title" text,
	"signature_kind" text,
	"signature" text,
	"signer_ip" text,
	"signer_user_agent" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"uploaded_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_earnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"client_id" uuid,
	"from_partner_id" uuid,
	"source_type" text,
	"source_id" uuid,
	"related_earning_id" uuid,
	"rule_id" uuid,
	"description" text NOT NULL,
	"basis_amount" bigint,
	"basis_currency" text,
	"rate_bp" integer,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"fx_rate" numeric(18, 8),
	"status" text DEFAULT 'payable' NOT NULL,
	"earned_on" date NOT NULL,
	"payout_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'counsellor' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"author_id" uuid,
	"from_partner" boolean NOT NULL,
	"client_id" uuid,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_key" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"superseded_at" timestamp with time zone,
	"name" text NOT NULL,
	"basis" text NOT NULL,
	"rate_bp" integer DEFAULT 0 NOT NULL,
	"fixed_amount" bigint DEFAULT 0 NOT NULL,
	"currency" text,
	"partner_id" uuid,
	"tier" text,
	"institution_id" uuid,
	"fee_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"applications_open" boolean DEFAULT true NOT NULL,
	"attribution_days" integer DEFAULT 365 NOT NULL,
	"default_withholding_bp" integer DEFAULT 0 NOT NULL,
	"require_second_approver" boolean DEFAULT true NOT NULL,
	"minimum_payout" bigint DEFAULT 0 NOT NULL,
	"tier_thresholds" jsonb DEFAULT '{"silver":5,"gold":15,"platinum":40}'::jsonb NOT NULL,
	"agreement_template" text DEFAULT '' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'sub_agent' NOT NULL,
	"status" text DEFAULT 'onboarding' NOT NULL,
	"tier" text DEFAULT 'standard' NOT NULL,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"country" text NOT NULL,
	"city" text,
	"address" text,
	"website" text,
	"registration_number" text,
	"tax_id" text,
	"manager_user_id" uuid,
	"parent_partner_id" uuid,
	"override_bp" integer DEFAULT 0 NOT NULL,
	"withholding_bp" integer,
	"currency" text DEFAULT 'PKR' NOT NULL,
	"bank_sealed" text,
	"source" text DEFAULT 'added' NOT NULL,
	"application" jsonb,
	"notes" text,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"period_label" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"gross" bigint NOT NULL,
	"withholding_bp" integer DEFAULT 0 NOT NULL,
	"withholding" bigint DEFAULT 0 NOT NULL,
	"advance_recovered" bigint DEFAULT 0 NOT NULL,
	"net" bigint NOT NULL,
	"notes" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"paid_on" date,
	"account_id" uuid,
	"method" "payment_method",
	"reference" text,
	"fx_rate" numeric(18, 8),
	"paid_by" uuid,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "partner_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "partner_attributed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "partner_registered_by" uuid;--> statement-breakpoint
ALTER TABLE "advance_recoveries" ADD CONSTRAINT "advance_recoveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_recoveries" ADD CONSTRAINT "advance_recoveries_advance_id_partner_advances_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."partner_advances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_recoveries" ADD CONSTRAINT "advance_recoveries_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_conflicts" ADD CONSTRAINT "attribution_conflicts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_conflicts" ADD CONSTRAINT "attribution_conflicts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_conflicts" ADD CONSTRAINT "attribution_conflicts_current_partner_id_partners_id_fk" FOREIGN KEY ("current_partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_conflicts" ADD CONSTRAINT "attribution_conflicts_claimant_partner_id_partners_id_fk" FOREIGN KEY ("claimant_partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_conflicts" ADD CONSTRAINT "attribution_conflicts_claimed_by_users_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_conflicts" ADD CONSTRAINT "attribution_conflicts_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_advances" ADD CONSTRAINT "partner_advances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_advances" ADD CONSTRAINT "partner_advances_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_advances" ADD CONSTRAINT "partner_advances_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_advances" ADD CONSTRAINT "partner_advances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_agreements" ADD CONSTRAINT "partner_agreements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_agreements" ADD CONSTRAINT "partner_agreements_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_agreements" ADD CONSTRAINT "partner_agreements_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_agreements" ADD CONSTRAINT "partner_agreements_signed_by_users_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_agreements" ADD CONSTRAINT "partner_agreements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_documents" ADD CONSTRAINT "partner_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_documents" ADD CONSTRAINT "partner_documents_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_documents" ADD CONSTRAINT "partner_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_documents" ADD CONSTRAINT "partner_documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_earnings" ADD CONSTRAINT "partner_earnings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_earnings" ADD CONSTRAINT "partner_earnings_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_earnings" ADD CONSTRAINT "partner_earnings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_earnings" ADD CONSTRAINT "partner_earnings_from_partner_id_partners_id_fk" FOREIGN KEY ("from_partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_earnings" ADD CONSTRAINT "partner_earnings_rule_id_partner_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."partner_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_earnings" ADD CONSTRAINT "partner_earnings_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_earnings" ADD CONSTRAINT "partner_earnings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_members" ADD CONSTRAINT "partner_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_members" ADD CONSTRAINT "partner_members_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_members" ADD CONSTRAINT "partner_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_members" ADD CONSTRAINT "partner_members_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_messages" ADD CONSTRAINT "partner_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_messages" ADD CONSTRAINT "partner_messages_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_messages" ADD CONSTRAINT "partner_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_messages" ADD CONSTRAINT "partner_messages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_rules" ADD CONSTRAINT "partner_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_rules" ADD CONSTRAINT "partner_rules_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_rules" ADD CONSTRAINT "partner_rules_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_rules" ADD CONSTRAINT "partner_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_settings" ADD CONSTRAINT "partner_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_settings" ADD CONSTRAINT "partner_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_manager_user_id_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_parent_partner_id_partners_id_fk" FOREIGN KEY ("parent_partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advance_recoveries_payout_idx" ON "advance_recoveries" USING btree ("payout_id");--> statement-breakpoint
CREATE INDEX "advance_recoveries_advance_idx" ON "advance_recoveries" USING btree ("advance_id");--> statement-breakpoint
CREATE INDEX "attribution_conflicts_tenant_status_idx" ON "attribution_conflicts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "attribution_conflicts_open_key" ON "attribution_conflicts" USING btree ("client_id","claimant_partner_id") WHERE status = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "partner_advances_tenant_number_key" ON "partner_advances" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "partner_advances_partner_idx" ON "partner_advances" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "partner_agreements_partner_idx" ON "partner_agreements" USING btree ("partner_id","version");--> statement-breakpoint
CREATE INDEX "partner_documents_partner_idx" ON "partner_documents" USING btree ("partner_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_earnings_tenant_number_key" ON "partner_earnings" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "partner_earnings_partner_status_idx" ON "partner_earnings" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX "partner_earnings_source_idx" ON "partner_earnings" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "partner_earnings_payout_idx" ON "partner_earnings" USING btree ("payout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_earnings_source_key" ON "partner_earnings" USING btree ("partner_id","kind","source_type","source_id") WHERE source_id is not null and kind <> 'adjustment';--> statement-breakpoint
CREATE UNIQUE INDEX "partner_members_user_key" ON "partner_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "partner_members_partner_idx" ON "partner_members" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "partner_messages_partner_idx" ON "partner_messages" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "partner_rules_tenant_idx" ON "partner_rules" USING btree ("tenant_id","basis");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_rules_key_version" ON "partner_rules" USING btree ("rule_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_tenant_number_key" ON "partners" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_tenant_email_key" ON "partners" USING btree ("tenant_id",lower("email"));--> statement-breakpoint
CREATE INDEX "partners_tenant_status_idx" ON "partners" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "partners_parent_idx" ON "partners" USING btree ("parent_partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_tenant_number_key" ON "payouts" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "payouts_partner_idx" ON "payouts" USING btree ("partner_id","status");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_partner_registered_by_users_id_fk" FOREIGN KEY ("partner_registered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clients_partner_idx" ON "clients" USING btree ("partner_id");--> statement-breakpoint
-- Every consultancy starts with the default partner settings.
INSERT INTO "partner_settings" ("tenant_id") SELECT "id" FROM "tenants" ON CONFLICT DO NOTHING;
