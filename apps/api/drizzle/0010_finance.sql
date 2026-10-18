ALTER TYPE "public"."invoice_status" ADD VALUE IF NOT EXISTS 'pending_approval';--> statement-breakpoint
CREATE TABLE "bank_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"line_count" integer NOT NULL,
	"imported_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"import_id" uuid,
	"line_date" date NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"amount" bigint NOT NULL,
	"fingerprint" text NOT NULL,
	"matched_line_id" uuid,
	"matched_by" uuid,
	"matched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"vendor" text NOT NULL,
	"vendor_reference" text,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"account_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"tax_amount" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"fx_rate" numeric(18, 8),
	"status" text DEFAULT 'open' NOT NULL,
	"paid_on" date,
	"paid_from_account_id" uuid,
	"method" "payment_method",
	"reference" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"tax_amount" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"issued_on" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text
);
--> statement-breakpoint
CREATE TABLE "day_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"close_date" date NOT NULL,
	"currency" text NOT NULL,
	"expected" bigint NOT NULL,
	"counted" bigint NOT NULL,
	"note" text,
	"entry_id" uuid,
	"closed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"spent_on" date NOT NULL,
	"account_id" uuid NOT NULL,
	"vendor" text NOT NULL,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"tax_amount" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"fx_rate" numeric(18, 8),
	"paid_from_account_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"client_id" uuid,
	"case_id" uuid,
	"receipt_key" text,
	"receipt_name" text,
	"receipt_mime" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text
);
--> statement-breakpoint
CREATE TABLE "finance_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"installment_id" uuid,
	"offset_days" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"base_currency" text DEFAULT 'PKR' NOT NULL,
	"bank_details" text,
	"invoice_terms" text,
	"discount_approval_bp" integer,
	"direct_refunds" boolean DEFAULT true NOT NULL,
	"late_fee_kind" text DEFAULT 'none' NOT NULL,
	"late_fee_value" bigint DEFAULT 0 NOT NULL,
	"late_fee_grace_days" integer DEFAULT 7 NOT NULL,
	"reminder_offsets" jsonb DEFAULT '[-3,0,7,14]'::jsonb NOT NULL,
	"locked_through" date,
	"locked_by" uuid,
	"journal_seq" integer DEFAULT 0 NOT NULL,
	"gateway_provider" text DEFAULT 'none' NOT NULL,
	"stripe_secret_key" text,
	"stripe_webhook_secret" text,
	"stripe_publishable_key" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"label" text,
	"due_date" date NOT NULL,
	"amount" bigint NOT NULL,
	"late_fee_invoice_id" uuid
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"entry_date" date NOT NULL,
	"memo" text NOT NULL,
	"currency" text NOT NULL,
	"fx_rate" numeric(18, 8),
	"source_type" text NOT NULL,
	"source_id" uuid,
	"reversal_of" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" bigint DEFAULT 0 NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL,
	"description" text,
	"client_id" uuid
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"subtype" text,
	"currency" text,
	"description" text,
	"system_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "online_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"url" text,
	"status" text DEFAULT 'created' NOT NULL,
	"payment_id" uuid,
	"started_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"paid_on" date NOT NULL,
	"note" text,
	"document_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"payment_id" uuid,
	"submitted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"kind" text NOT NULL,
	"value" bigint NOT NULL,
	"currency" text,
	"valid_from" date,
	"valid_to" date,
	"max_uses" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"client_id" uuid NOT NULL,
	"case_id" uuid,
	"currency" text NOT NULL,
	"issue_date" date NOT NULL,
	"valid_until" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"proforma" boolean DEFAULT false NOT NULL,
	"items" jsonb NOT NULL,
	"subtotal" bigint NOT NULL,
	"discount_total" bigint DEFAULT 0 NOT NULL,
	"tax_total" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"promo_code_id" uuid,
	"promo_snapshot" jsonb,
	"notes" text,
	"invoice_id" uuid,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"method" "payment_method" NOT NULL,
	"account_id" uuid,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rate_bp" integer NOT NULL,
	"inclusive" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "category" text DEFAULT 'service' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "discount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "tax_rate_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "tax_rate_name" text;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "tax_rate_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "tax_inclusive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "tax_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "line_total" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "subtotal" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "discount_total" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_total" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "promo_code_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "discount_reason" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "fx_rate" numeric(18, 8);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "quote_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "parent_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "late_fee_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "fx_rate" numeric(18, 8);--> statement-breakpoint
ALTER TABLE "service_packages" ADD COLUMN "category" text DEFAULT 'service' NOT NULL;--> statement-breakpoint
ALTER TABLE "service_packages" ADD COLUMN "tax_rate_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_imports" ADD CONSTRAINT "bank_imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_imports" ADD CONSTRAINT "bank_imports_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_imports" ADD CONSTRAINT "bank_imports_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_import_id_bank_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."bank_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_matched_line_id_journal_lines_id_fk" FOREIGN KEY ("matched_line_id") REFERENCES "public"."journal_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_matched_by_users_id_fk" FOREIGN KEY ("matched_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_paid_from_account_id_ledger_accounts_id_fk" FOREIGN KEY ("paid_from_account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_closes" ADD CONSTRAINT "day_closes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_closes" ADD CONSTRAINT "day_closes_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_closes" ADD CONSTRAINT "day_closes_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_closes" ADD CONSTRAINT "day_closes_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_from_account_id_ledger_accounts_id_fk" FOREIGN KEY ("paid_from_account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_reminders" ADD CONSTRAINT "finance_reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_reminders" ADD CONSTRAINT "finance_reminders_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_reminders" ADD CONSTRAINT "finance_reminders_installment_id_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."installments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payments" ADD CONSTRAINT "online_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payments" ADD CONSTRAINT "online_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payments" ADD CONSTRAINT "online_payments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payments" ADD CONSTRAINT "online_payments_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payments" ADD CONSTRAINT "online_payments_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_lines_fingerprint_key" ON "bank_lines" USING btree ("account_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_lines_matched_key" ON "bank_lines" USING btree ("matched_line_id") WHERE matched_line_id is not null;--> statement-breakpoint
CREATE INDEX "bank_lines_account_date_idx" ON "bank_lines" USING btree ("account_id","line_date");--> statement-breakpoint
CREATE UNIQUE INDEX "bills_tenant_number_key" ON "bills" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "bills_tenant_status_due_idx" ON "bills" USING btree ("tenant_id","status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_tenant_number_key" ON "credit_notes" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "credit_notes_invoice_idx" ON "credit_notes" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "day_closes_key" ON "day_closes" USING btree ("account_id","close_date","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_tenant_number_key" ON "expenses" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "expenses_tenant_date_idx" ON "expenses" USING btree ("tenant_id","spent_on");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_reminders_key" ON "finance_reminders" USING btree ("invoice_id",coalesce(installment_id, '00000000-0000-0000-0000-000000000000'::uuid),"offset_days");--> statement-breakpoint
CREATE UNIQUE INDEX "installments_invoice_seq_key" ON "installments" USING btree ("invoice_id","seq");--> statement-breakpoint
CREATE INDEX "installments_tenant_due_idx" ON "installments" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_tenant_number_key" ON "journal_entries" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "journal_entries_tenant_date_idx" ON "journal_entries" USING btree ("tenant_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_entries_source_idx" ON "journal_entries" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_reversal_key" ON "journal_entries" USING btree ("reversal_of") WHERE reversal_of is not null;--> statement-breakpoint
CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_account_idx" ON "journal_lines" USING btree ("tenant_id","account_id");--> statement-breakpoint
CREATE INDEX "journal_lines_client_idx" ON "journal_lines" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_tenant_code_key" ON "ledger_accounts" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_tenant_system_key" ON "ledger_accounts" USING btree ("tenant_id","system_key") WHERE system_key is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "online_payments_provider_ref_key" ON "online_payments" USING btree ("provider","provider_ref") WHERE provider_ref is not null;--> statement-breakpoint
CREATE INDEX "online_payments_invoice_idx" ON "online_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payment_submissions_tenant_status_idx" ON "payment_submissions" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "payment_submissions_invoice_idx" ON "payment_submissions" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_codes_tenant_code_key" ON "promo_codes" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_tenant_number_key" ON "quotes" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "quotes_tenant_client_idx" ON "quotes" USING btree ("tenant_id","client_id");--> statement-breakpoint
CREATE INDEX "refund_requests_tenant_status_idx" ON "refund_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "refund_requests_invoice_idx" ON "refund_requests" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rates_tenant_name_key" ON "tax_rates" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_packages" ADD CONSTRAINT "service_packages_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_parent_idx" ON "invoices" USING btree ("parent_invoice_id");--> statement-breakpoint
-- Hand-written. Additive only: new tables and columns, filled in below. To
-- undo, run drizzle/rollback/0010_finance.down.sql.
--
-- 1. The journal's rules, in the database so no code path can break them.
--    A line is a debit or a credit, never both or neither.
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_one_side" CHECK ("debit" >= 0 AND "credit" >= 0 AND (("debit" > 0) <> ("credit" > 0)));--> statement-breakpoint
--    Nothing posted is ever changed or removed: corrections are reversing entries.
CREATE OR REPLACE FUNCTION journal_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'The journal is append-only: post a reversing entry instead.' USING ERRCODE = 'check_violation';
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER journal_entries_immutable BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION journal_immutable();--> statement-breakpoint
CREATE TRIGGER journal_lines_immutable BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION journal_immutable();--> statement-breakpoint
--    Every entry balances, checked when the transaction commits (so its lines
--    can be written one by one inside it).
CREATE OR REPLACE FUNCTION journal_entry_balanced() RETURNS trigger AS $$
DECLARE
  d bigint;
  c bigint;
  n int;
  eid uuid;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN eid := NEW.id; ELSE eid := NEW.entry_id; END IF;
  SELECT COALESCE(sum(debit), 0), COALESCE(sum(credit), 0), count(*) INTO d, c, n FROM journal_lines WHERE entry_id = eid;
  IF n < 2 OR d <> c THEN
    RAISE EXCEPTION 'Journal entry % does not balance (debits %, credits %, % lines).', eid, d, c, n USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_balanced AFTER INSERT ON "journal_entries"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();--> statement-breakpoint
--    A closed period stays closed: nothing can be dated on or before the lock.
CREATE OR REPLACE FUNCTION journal_period_lock() RETURNS trigger AS $$
DECLARE
  lock date;
BEGIN
  SELECT locked_through INTO lock FROM finance_settings WHERE tenant_id = NEW.tenant_id;
  IF lock IS NOT NULL AND NEW.entry_date <= lock THEN
    RAISE EXCEPTION 'The books are closed up to %. Date it after that, or ask a manager to reopen the period.', lock
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER journal_entries_period_lock BEFORE INSERT ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION journal_period_lock();--> statement-breakpoint
-- 2. Settings and the chart of accounts for every consultancy (the same rows
--    tenant-defaults.ts gives a new one, from SYSTEM_ACCOUNTS in @crm/shared).
INSERT INTO "finance_settings" ("tenant_id") SELECT "id" FROM "tenants" ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "ledger_accounts" ("tenant_id", "system_key", "code", "name", "type", "subtype", "description")
SELECT t."id", v.key, v.code, v.name, v.type, v.subtype, NULLIF(v.description, '')
FROM "tenants" t CROSS JOIN (VALUES
  ('cash', '1000', 'Cash in hand', 'asset', 'cash', 'Cash received at the office and not yet banked.'),
  ('bank', '1010', 'Bank account', 'asset', 'bank', 'The main business bank account.'),
  ('online', '1020', 'Online payments', 'asset', 'clearing', 'Card and wallet payments (Stripe, JazzCash, Easypaisa) until they are paid out to the bank.'),
  ('receivable', '1100', 'Accounts receivable', 'asset', 'receivable', 'What students owe on issued invoices.'),
  ('commission_receivable', '1150', 'Commissions receivable', 'asset', NULL, 'What universities owe in commission.'),
  ('disbursements', '1200', 'Disbursements recoverable', 'asset', NULL, 'Fees paid on a student’s behalf (application, visa, university) and invoiced back to them. Never revenue.'),
  ('partner_advances', '1300', 'Advances to partners', 'asset', NULL, 'Money paid to partners ahead of the commission it will be set against.'),
  ('payable', '2000', 'Accounts payable', 'liability', 'payable', 'Bills received and not yet paid.'),
  ('tax_payable', '2100', 'Sales tax payable', 'liability', 'tax', 'Tax charged on invoices, owed to the tax authority.'),
  ('partner_payable', '2200', 'Partner commissions payable', 'liability', NULL, 'Commission earned by partners and not yet paid out.'),
  ('withholding_payable', '2300', 'Withholding tax payable', 'liability', NULL, 'Tax withheld from partner payouts, owed to the tax authority.'),
  ('equity', '3000', 'Owner’s equity', 'equity', NULL, 'Money the owners put in or took out.'),
  ('retained', '3100', 'Retained earnings', 'equity', NULL, 'Profit kept from earlier periods.'),
  ('fees_service', '4000', 'Consultancy fees', 'income', NULL, 'Counselling, application and visa service packages.'),
  ('fees_course', '4010', 'Course fees', 'income', NULL, 'IELTS, PTE and other test preparation and language courses.'),
  ('fees_application', '4020', 'Application handling fees', 'income', NULL, 'The consultancy’s own fee for handling applications.'),
  ('fees_visa', '4030', 'Visa service fees', 'income', NULL, 'The consultancy’s own fee for visa filing.'),
  ('commission_income', '4100', 'University commissions', 'income', NULL, 'Commission earned from universities.'),
  ('late_fees', '4200', 'Late payment fees', 'income', NULL, 'Fees charged on overdue invoices.'),
  ('other_income', '4300', 'Other income', 'income', NULL, 'Anything else that comes in.'),
  ('sales_returns', '4900', 'Discounts and credit notes', 'income', 'contra_income', 'Revenue given back through credit notes. Reduces income.'),
  ('partner_commission', '5000', 'Partner commissions', 'expense', NULL, 'Commission owed to sub-agents and referral partners.'),
  ('salaries', '5100', 'Salaries and wages', 'expense', NULL, ''),
  ('rent', '5200', 'Rent and utilities', 'expense', NULL, ''),
  ('marketing', '5300', 'Marketing and advertising', 'expense', NULL, ''),
  ('software', '5400', 'Software and subscriptions', 'expense', NULL, ''),
  ('travel', '5500', 'Travel and events', 'expense', NULL, ''),
  ('bank_charges', '5600', 'Bank and payment charges', 'expense', NULL, 'Bank fees, card and gateway charges.'),
  ('office', '5700', 'Office and supplies', 'expense', NULL, ''),
  ('professional', '5800', 'Professional fees', 'expense', NULL, 'Accountants, lawyers, translators.'),
  ('fx_differences', '5850', 'Exchange differences', 'expense', NULL, 'Gains and losses when money arrives at a different rate than booked.'),
  ('cash_over_short', '5880', 'Cash over and short', 'expense', NULL, 'Differences found when the cash is counted.'),
  ('other_expense', '5900', 'Other expenses', 'expense', NULL, '')
) AS v(key, code, name, type, subtype, description)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- 3. Existing invoices had no discount or tax, so the subtotal and every
--    line's total are what they always were. Existing payments go to the
--    account their method lands in.
UPDATE "invoice_items" SET "line_total" = "amount";--> statement-breakpoint
UPDATE "invoices" SET "subtotal" = "total";--> statement-breakpoint
UPDATE "payments" p SET "account_id" = a."id"
FROM "ledger_accounts" a
WHERE a."tenant_id" = p."tenant_id" AND a."system_key" = CASE p."method"
  WHEN 'cash' THEN 'cash' WHEN 'card' THEN 'online' WHEN 'online' THEN 'online' ELSE 'bank' END;--> statement-breakpoint
-- 4. The journal for everything already recorded, so the books agree with
--    the invoices from the first day: each invoice (and its voiding), each
--    payment and refund (and its voiding), on the dates they happened. The
--    balance triggers above check every one of these entries.
CREATE TEMP TABLE "_fin_events" AS
SELECT gen_random_uuid() AS entry_id, e.* FROM (
  SELECT i."id" AS source_id, i."tenant_id", i."issue_date" AS event_date, i."created_at" AS ts, 1 AS ord,
    'invoice'::text AS source_type, i."currency", i."total" AS amount, i."client_id",
    'receivable'::text AS dr_key, 'fees_service'::text AS cr_key,
    'Invoice ' || i."number" AS memo, NULL::uuid AS reverses
  FROM "invoices" i WHERE i."total" > 0
  UNION ALL
  SELECT i."id", i."tenant_id", i."voided_at"::date, i."voided_at", 2,
    'invoice_void', i."currency", i."total", i."client_id",
    'fees_service', 'receivable',
    'Invoice ' || i."number" || ' voided' || COALESCE(': ' || i."void_reason", ''), i."id"
  FROM "invoices" i WHERE i."status" = 'void' AND i."voided_at" IS NOT NULL AND i."total" > 0
  UNION ALL
  SELECT p."id", p."tenant_id", p."received_on", p."created_at", 1,
    'payment', p."currency", p."amount", p."client_id",
    CASE WHEN p."kind" = 'payment' THEN a."system_key" ELSE 'receivable' END,
    CASE WHEN p."kind" = 'payment' THEN 'receivable' ELSE a."system_key" END,
    CASE WHEN p."kind" = 'payment' THEN 'Payment ' ELSE 'Refund ' END || p."number", NULL::uuid
  FROM "payments" p JOIN "ledger_accounts" a ON a."id" = p."account_id"
  UNION ALL
  SELECT p."id", p."tenant_id", p."voided_at"::date, p."voided_at", 2,
    'payment_void', p."currency", p."amount", p."client_id",
    CASE WHEN p."kind" = 'payment' THEN 'receivable' ELSE a."system_key" END,
    CASE WHEN p."kind" = 'payment' THEN a."system_key" ELSE 'receivable' END,
    CASE WHEN p."kind" = 'payment' THEN 'Payment ' ELSE 'Refund ' END || p."number" || ' voided' || COALESCE(': ' || p."void_reason", ''), p."id"
  FROM "payments" p JOIN "ledger_accounts" a ON a."id" = p."account_id"
  WHERE p."voided_at" IS NOT NULL
) e;--> statement-breakpoint
INSERT INTO "journal_entries" ("id", "tenant_id", "number", "entry_date", "memo", "currency", "fx_rate", "source_type", "source_id", "reversal_of", "created_at")
SELECT e.entry_id, e.tenant_id,
  'JE-' || lpad((row_number() OVER (PARTITION BY e.tenant_id ORDER BY e.event_date, e.ts, e.ord))::text, 6, '0'),
  e.event_date, e.memo, e.currency, CASE WHEN e.currency = 'PKR' THEN 1 END, e.source_type, e.source_id,
  (SELECT o.entry_id FROM "_fin_events" o WHERE o.source_id = e.reverses AND o.ord = 1),
  e.ts
FROM "_fin_events" e;--> statement-breakpoint
INSERT INTO "journal_lines" ("tenant_id", "entry_id", "account_id", "debit", "credit", "client_id")
SELECT e.tenant_id, e.entry_id, a."id", e.amount, 0, e.client_id
FROM "_fin_events" e JOIN "ledger_accounts" a ON a."tenant_id" = e.tenant_id AND a."system_key" = e.dr_key
UNION ALL
SELECT e.tenant_id, e.entry_id, a."id", 0, e.amount, e.client_id
FROM "_fin_events" e JOIN "ledger_accounts" a ON a."tenant_id" = e.tenant_id AND a."system_key" = e.cr_key;--> statement-breakpoint
DROP TABLE "_fin_events";--> statement-breakpoint
-- 5. Senior consultants (the seeded role) may approve refunds and discounts.
UPDATE "staff_roles" SET "effects" = "effects" || '{"billing.approve":"allow"}'::jsonb
WHERE "system_key" = 'senior' AND NOT ("effects" ? 'billing.approve');
--> statement-breakpoint
-- 6. Journal numbers continue from the backfilled entries.
UPDATE "finance_settings" s SET "journal_seq" = n.c
FROM (SELECT "tenant_id", count(*)::int AS c FROM "journal_entries" GROUP BY "tenant_id") n
WHERE n."tenant_id" = s."tenant_id";
