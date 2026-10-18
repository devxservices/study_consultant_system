CREATE TABLE "tenant_sync" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_sync" ADD CONSTRAINT "tenant_sync_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Hand-written backfill. Every consultancy starts with "changed now", so a page
-- any browser kept from before this migration is re-rendered, not trusted.
-- Additive only. To undo: DROP TABLE "tenant_sync";
INSERT INTO "tenant_sync" ("tenant_id") SELECT "id" FROM "tenants" ON CONFLICT DO NOTHING;
