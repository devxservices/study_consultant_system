-- The university catalogue is removed. Applications keep the university and
-- programme they name as plain text (target_university, target_program).
ALTER TABLE "cases" DROP CONSTRAINT IF EXISTS "cases_program_id_programs_id_fk";--> statement-breakpoint
ALTER TABLE "cases" DROP COLUMN IF EXISTS "program_id";--> statement-breakpoint
DROP TABLE IF EXISTS "programs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "universities" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."study_level";--> statement-breakpoint
-- No plan offers the module any more, and nobody can be allowed or denied it.
UPDATE "plans" SET "modules" = "modules" - 'catalog' WHERE "modules" @> '["catalog"]'::jsonb;--> statement-breakpoint
DELETE FROM "role_permissions" WHERE "permission" = 'catalog.edit';--> statement-breakpoint
DELETE FROM "user_permissions" WHERE "permission" = 'catalog.edit';
