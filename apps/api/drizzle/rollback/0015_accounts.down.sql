-- Undo 0015: password links, "sign out everywhere", domain pointing checks.
-- Nothing here holds data that the older structure needs: unused links simply
-- stop working, sessions stop being revocable, and pointing is re-checked.

DROP TABLE IF EXISTS password_tokens;
ALTER TABLE users DROP COLUMN IF EXISTS sessions_valid_after;
ALTER TABLE tenant_domains DROP COLUMN IF EXISTS points_here_at;
ALTER TABLE tenant_domains DROP COLUMN IF EXISTS dns_checked_at;
