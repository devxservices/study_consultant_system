CREATE TABLE "course_enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"city" text,
	"course_id" uuid,
	"batch_id" uuid,
	"source" text DEFAULT 'walk_in' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"study_abroad" boolean DEFAULT false NOT NULL,
	"target_score" numeric(7, 2),
	"assigned_to" uuid,
	"follow_up_on" date,
	"trial_session_id" uuid,
	"trial_outcome" text,
	"lost_reason" text,
	"client_id" uuid,
	"enrollment_id" uuid,
	"notes" text,
	"last_contact_at" timestamp with time zone,
	"reminded_on" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_enquiry_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "programme" text DEFAULT 'study_abroad' NOT NULL;--> statement-breakpoint
ALTER TABLE "course_enquiries" ADD CONSTRAINT "course_enquiries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enquiries" ADD CONSTRAINT "course_enquiries_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enquiries" ADD CONSTRAINT "course_enquiries_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enquiries" ADD CONSTRAINT "course_enquiries_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enquiries" ADD CONSTRAINT "course_enquiries_trial_session_id_class_sessions_id_fk" FOREIGN KEY ("trial_session_id") REFERENCES "public"."class_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enquiries" ADD CONSTRAINT "course_enquiries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enquiries" ADD CONSTRAINT "course_enquiries_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enquiries" ADD CONSTRAINT "course_enquiries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enquiry_events" ADD CONSTRAINT "course_enquiry_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enquiry_events" ADD CONSTRAINT "course_enquiry_events_enquiry_id_course_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."course_enquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enquiry_events" ADD CONSTRAINT "course_enquiry_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_enquiries_tenant_number_key" ON "course_enquiries" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "course_enquiries_tenant_status_idx" ON "course_enquiries" USING btree ("tenant_id","status","follow_up_on");--> statement-breakpoint
CREATE INDEX "course_enquiries_assigned_idx" ON "course_enquiries" USING btree ("assigned_to","status");--> statement-breakpoint
CREATE INDEX "course_enquiries_trial_idx" ON "course_enquiries" USING btree ("trial_session_id");--> statement-breakpoint
CREATE INDEX "course_enquiries_client_idx" ON "course_enquiries" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "course_enquiry_events_enquiry_idx" ON "course_enquiry_events" USING btree ("enquiry_id","created_at");