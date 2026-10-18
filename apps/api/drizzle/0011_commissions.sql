CREATE TABLE "commission_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"institution_id" uuid NOT NULL,
	"title" text NOT NULL,
	"reference" text,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"currency" text NOT NULL,
	"claim_after_days" integer DEFAULT 30 NOT NULL,
	"payment_terms_days" integer DEFAULT 45 NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"document_key" text,
	"document_name" text,
	"document_mime" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"institution_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"period_label" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_on" date,
	"due_on" date,
	"last_follow_up_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"basis" text NOT NULL,
	"rate_bp" integer DEFAULT 0 NOT NULL,
	"fixed_amount" bigint DEFAULT 0 NOT NULL,
	"years" text DEFAULT 'first_year' NOT NULL,
	"year_count" integer DEFAULT 1 NOT NULL,
	"tiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bonus_students" integer,
	"bonus_amount" bigint,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retention_days" integer DEFAULT 0 NOT NULL,
	"trigger_stage" text DEFAULT 'fee_payment' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"consultant_share_bp" integer DEFAULT 0 NOT NULL,
	"follow_up_days" integer DEFAULT 14 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"commission_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"share_bp" integer NOT NULL,
	"paid_on" date,
	"paid_amount" bigint,
	"paid_by" uuid,
	"account_id" uuid
);
--> statement-breakpoint
CREATE TABLE "commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"kind" text DEFAULT 'student' NOT NULL,
	"case_id" uuid,
	"client_id" uuid,
	"institution_id" uuid NOT NULL,
	"agreement_id" uuid,
	"rule_id" uuid,
	"rule_snapshot" jsonb,
	"year_no" integer DEFAULT 1 NOT NULL,
	"intake" text,
	"tuition" bigint,
	"rate_bp" integer,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"fx_rate" numeric(18, 8),
	"status" text DEFAULT 'expected' NOT NULL,
	"claimable_on" date,
	"expected_on" date,
	"retention_until" date,
	"confirmed_at" timestamp with time zone,
	"claim_id" uuid,
	"adjusted_amount" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"due_notified_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institution_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"institution_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"email" text,
	"phone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institution_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"institution_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"currency" text NOT NULL,
	"amount" bigint NOT NULL,
	"bank_charges" bigint DEFAULT 0 NOT NULL,
	"fx_rate" numeric(18, 8),
	"account_id" uuid NOT NULL,
	"method" "payment_method" DEFAULT 'bank_transfer' NOT NULL,
	"reference" text,
	"claim_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text
);
--> statement-breakpoint
CREATE TABLE "institutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"city" text,
	"type" text DEFAULT 'university' NOT NULL,
	"website" text,
	"currency" text NOT NULL,
	"aggregator" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"commission_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"fx_difference" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "institution_id" uuid;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "tuition_fee" bigint;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "tuition_currency" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "scholarship" bigint;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "course_start" date;--> statement-breakpoint
ALTER TABLE "commission_agreements" ADD CONSTRAINT "commission_agreements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_agreements" ADD CONSTRAINT "commission_agreements_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_agreements" ADD CONSTRAINT "commission_agreements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_claims" ADD CONSTRAINT "commission_claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_claims" ADD CONSTRAINT "commission_claims_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_claims" ADD CONSTRAINT "commission_claims_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_agreement_id_commission_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."commission_agreements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_settings" ADD CONSTRAINT "commission_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_settings" ADD CONSTRAINT "commission_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_splits" ADD CONSTRAINT "commission_splits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_splits" ADD CONSTRAINT "commission_splits_commission_id_commissions_id_fk" FOREIGN KEY ("commission_id") REFERENCES "public"."commissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_splits" ADD CONSTRAINT "commission_splits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_splits" ADD CONSTRAINT "commission_splits_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_splits" ADD CONSTRAINT "commission_splits_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_agreement_id_commission_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."commission_agreements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_rule_id_commission_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_claim_id_commission_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."commission_claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_contacts" ADD CONSTRAINT "institution_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_contacts" ADD CONSTRAINT "institution_contacts_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_receipts" ADD CONSTRAINT "institution_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_receipts" ADD CONSTRAINT "institution_receipts_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_receipts" ADD CONSTRAINT "institution_receipts_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_receipts" ADD CONSTRAINT "institution_receipts_claim_id_commission_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."commission_claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_receipts" ADD CONSTRAINT "institution_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_receipts" ADD CONSTRAINT "institution_receipts_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_receipt_id_institution_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."institution_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_commission_id_commissions_id_fk" FOREIGN KEY ("commission_id") REFERENCES "public"."commissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_agreements_institution_idx" ON "commission_agreements" USING btree ("institution_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "commission_claims_tenant_number_key" ON "commission_claims" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "commission_claims_institution_idx" ON "commission_claims" USING btree ("institution_id","status");--> statement-breakpoint
CREATE INDEX "commission_rules_agreement_idx" ON "commission_rules" USING btree ("agreement_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "commission_splits_key" ON "commission_splits" USING btree ("commission_id","user_id");--> statement-breakpoint
CREATE INDEX "commission_splits_user_idx" ON "commission_splits" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commissions_tenant_number_key" ON "commissions" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "commissions_case_rule_year_key" ON "commissions" USING btree ("case_id","agreement_id","year_no") WHERE kind = 'student' and status <> 'cancelled';--> statement-breakpoint
CREATE INDEX "commissions_tenant_status_idx" ON "commissions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "commissions_institution_idx" ON "commissions" USING btree ("institution_id","status");--> statement-breakpoint
CREATE INDEX "commissions_case_idx" ON "commissions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "commissions_claim_idx" ON "commissions" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "institution_contacts_institution_idx" ON "institution_contacts" USING btree ("institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "institution_receipts_tenant_number_key" ON "institution_receipts" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "institution_receipts_institution_idx" ON "institution_receipts" USING btree ("institution_id","received_on");--> statement-breakpoint
CREATE UNIQUE INDEX "institutions_tenant_name_key" ON "institutions" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX "institutions_tenant_country_idx" ON "institutions" USING btree ("tenant_id","country");--> statement-breakpoint
CREATE INDEX "receipt_allocations_commission_idx" ON "receipt_allocations" USING btree ("commission_id");--> statement-breakpoint
CREATE INDEX "receipt_allocations_receipt_idx" ON "receipt_allocations" USING btree ("receipt_id");--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Hand-written. Additive only. To undo, run drizzle/rollback/0011_commissions.down.sql.
--
-- 1. Two accounts commissions post to, for every consultancy (as in
--    SYSTEM_ACCOUNTS), and the commission settings row.
INSERT INTO "ledger_accounts" ("tenant_id", "system_key", "code", "name", "type", "description")
SELECT t."id", v.key, v.code, v.name, 'expense', v.description
FROM "tenants" t CROSS JOIN (VALUES
  ('staff_incentives', '5150', 'Staff incentives', 'Consultants’ shares of the commissions they bring in.'),
  ('bad_debts', '5890', 'Bad debts written off', 'Commission or fees given up on as uncollectable.')
) AS v(key, code, name, description)
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "commission_settings" ("tenant_id") SELECT "id" FROM "tenants" ON CONFLICT DO NOTHING;--> statement-breakpoint
-- 2. The universities students are already applying to become the start of
--    the catalogue (one per name and country, case-insensitively), in the
--    destination's currency where the consultancy has described it, and the
--    applications are linked to them. What was typed stays on the application.
INSERT INTO "institutions" ("tenant_id", "name", "country", "currency", "notes")
SELECT DISTINCT ON (c."tenant_id", lower(trim(c."target_university")))
  c."tenant_id",
  trim(c."target_university"),
  c."target_country",
  COALESCE(
    (SELECT co."currency" FROM "countries" co WHERE co."tenant_id" = c."tenant_id" AND lower(co."name") = lower(c."target_country") LIMIT 1),
    CASE lower(c."target_country")
      WHEN 'united kingdom' THEN 'GBP' WHEN 'uk' THEN 'GBP'
      WHEN 'canada' THEN 'CAD' WHEN 'australia' THEN 'AUD'
      WHEN 'germany' THEN 'EUR' WHEN 'ireland' THEN 'EUR' WHEN 'france' THEN 'EUR' WHEN 'netherlands' THEN 'EUR'
      WHEN 'italy' THEN 'EUR' WHEN 'spain' THEN 'EUR' WHEN 'finland' THEN 'EUR'
      ELSE 'USD' END
  ),
  'Added from the applications already on file. Check the currency, and add the agreement.'
FROM "cases" c
WHERE c."target_university" IS NOT NULL AND length(trim(c."target_university")) >= 2
ORDER BY c."tenant_id", lower(trim(c."target_university")), c."created_at"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "cases" c SET "institution_id" = i."id"
FROM "institutions" i
WHERE i."tenant_id" = c."tenant_id" AND lower(i."name") = lower(trim(c."target_university")) AND c."institution_id" IS NULL;
