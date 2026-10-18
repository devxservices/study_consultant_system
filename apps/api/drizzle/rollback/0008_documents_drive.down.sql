-- Undo 0008: the documents drive.
-- Refuses while documents exist that only the drive can hold: ones that
-- belong to a student or the agency rather than to one application, and
-- ones in the two new review states. Trash is emptied back to the original
-- soft delete (deleted_at) so nothing reappears.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM documents WHERE case_id IS NULL OR client_id IS NULL) THEN
    RAISE EXCEPTION 'Documents not attached to an application exist; attach or remove them first.';
  END IF;
  IF EXISTS (SELECT 1 FROM documents WHERE status IN ('under_review', 'reupload_requested')) THEN
    RAISE EXCEPTION 'Documents are under review or awaiting a re-upload; decide them first.';
  END IF;
END $$;

UPDATE documents SET deleted_at = COALESCE(deleted_at, trashed_at) WHERE trashed_at IS NOT NULL;

DROP TRIGGER IF EXISTS documents_fill_defaults ON documents;
DROP FUNCTION IF EXISTS documents_fill_defaults();

DROP INDEX IF EXISTS documents_client_folder_idx;
DROP INDEX IF EXISTS documents_expiry_idx;
DROP INDEX IF EXISTS documents_version_group_idx;
DROP INDEX IF EXISTS documents_client_checksum_idx;
DROP INDEX IF EXISTS documents_tenant_uploaded_idx;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_folder_id_doc_folders_id_fk;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_trashed_by_users_id_fk;
ALTER TABLE documents
  DROP COLUMN IF EXISTS type_key,
  DROP COLUMN IF EXISTS folder_id,
  DROP COLUMN IF EXISTS version_group,
  DROP COLUMN IF EXISTS version,
  DROP COLUMN IF EXISTS tags,
  DROP COLUMN IF EXISTS color,
  DROP COLUMN IF EXISTS expires_on,
  DROP COLUMN IF EXISTS issued_on,
  DROP COLUMN IF EXISTS expiry_notified_days,
  DROP COLUMN IF EXISTS duplicate_of,
  DROP COLUMN IF EXISTS trashed_at,
  DROP COLUMN IF EXISTS trashed_by;
ALTER TABLE documents ALTER COLUMN case_id SET NOT NULL;
ALTER TABLE documents ALTER COLUMN client_id SET NOT NULL;
ALTER TABLE cases DROP COLUMN IF EXISTS study_level, DROP COLUMN IF EXISTS visa_type;

DROP TABLE IF EXISTS share_access_log;
DROP TABLE IF EXISTS share_links;
DROP TABLE IF EXISTS upload_sessions;
DROP TABLE IF EXISTS resource_grants;
DROP TABLE IF EXISTS drive_stars;
DROP TABLE IF EXISTS drive_settings;
DROP TABLE IF EXISTS requirement_sets;
DROP TABLE IF EXISTS folder_templates;
DROP TABLE IF EXISTS document_types;
DROP TABLE IF EXISTS doc_folders;
-- document_status keeps 'under_review' and 'reupload_requested' (unused).
