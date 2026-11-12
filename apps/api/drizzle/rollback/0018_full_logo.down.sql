-- Undo 0018_full_logo. The uploaded files stay in storage under
-- tenants/<id>/branding/full-logo-*; delete them by hand if they should go too.
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "full_logo_key";
