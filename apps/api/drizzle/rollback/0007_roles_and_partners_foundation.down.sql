-- Undo 0007: role templates, the partner link on users, email settings.
-- Refuses while any user is a partner (their portal role cannot be
-- represented without this migration's structures).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE role = 'partner') THEN
    RAISE EXCEPTION 'Partner users exist; remove or convert them first.';
  END IF;
END $$;

DROP INDEX IF EXISTS users_staff_role_idx;
DROP INDEX IF EXISTS users_partner_idx;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_staff_role_id_staff_roles_id_fk;
ALTER TABLE users DROP COLUMN IF EXISTS staff_role_id;
ALTER TABLE users DROP COLUMN IF EXISTS partner_id;
ALTER TABLE tenants DROP COLUMN IF EXISTS email_notifications;
DROP TABLE IF EXISTS staff_roles;
-- notification_type and role keep their added values (enums cannot shrink).
