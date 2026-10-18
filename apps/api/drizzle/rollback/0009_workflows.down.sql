-- Undo 0009: countries, workflows and automations.
-- Refuses while any application runs on a workflow other than Standard -
-- its place in that workflow cannot be expressed by the ten stages alone.
-- (Its category, in cases.current_stage, is always kept up to date, so
-- after converting such applications to Standard nothing is lost.)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cases c
    JOIN workflow_versions v ON v.id = c.workflow_version_id
    JOIN workflow_templates t ON t.id = v.template_id
    WHERE NOT t.is_default
  ) THEN
    RAISE EXCEPTION 'Applications run on custom workflows; move them to Standard first.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS cases_fill_workflow ON cases;
DROP FUNCTION IF EXISTS cases_fill_workflow();
DROP TRIGGER IF EXISTS stage_events_fill_workflow ON case_stage_events;
DROP FUNCTION IF EXISTS stage_events_fill_workflow();
DROP TRIGGER IF EXISTS workflow_stages_guard ON workflow_stages;
DROP FUNCTION IF EXISTS workflow_stages_guard();

DROP INDEX IF EXISTS cases_workflow_stage_idx;
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_workflow_version_id_workflow_versions_id_fk;
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_stage_approved_by_users_id_fk;
ALTER TABLE cases
  DROP COLUMN IF EXISTS workflow_version_id,
  DROP COLUMN IF EXISTS current_stage_key,
  DROP COLUMN IF EXISTS current_stage_name,
  DROP COLUMN IF EXISTS stage_sla_days,
  DROP COLUMN IF EXISTS stage_approved_at,
  DROP COLUMN IF EXISTS stage_approved_by;
ALTER TABLE case_stage_events DROP CONSTRAINT IF EXISTS case_stage_events_workflow_version_id_workflow_versions_id_fk;
ALTER TABLE case_stage_events DROP COLUMN IF EXISTS stage_key, DROP COLUMN IF EXISTS workflow_version_id;

DROP TABLE IF EXISTS automation_runs;
DROP TABLE IF EXISTS automation_rules;
DROP TABLE IF EXISTS workflow_stages;
DROP TABLE IF EXISTS workflow_versions;
DROP TABLE IF EXISTS workflow_templates;
DROP TABLE IF EXISTS countries;

UPDATE staff_roles SET effects = effects - 'case.approve' WHERE system_key = 'senior';
-- notification_type keeps 'workflow_alert' (enums cannot shrink); rows of it
-- stay readable in the bell.
