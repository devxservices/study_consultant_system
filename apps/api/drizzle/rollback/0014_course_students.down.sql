-- Undo 0014: course enquiries and course-only students.
-- Refuses while any enquiry exists or any client is marked course-only (those
-- students would silently become study-abroad clients).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM course_enquiries) THEN
    RAISE EXCEPTION 'Course enquiries exist.';
  END IF;
  IF EXISTS (SELECT 1 FROM clients WHERE programme <> 'study_abroad') THEN
    RAISE EXCEPTION 'Some clients are course-only students.';
  END IF;
END $$;

DROP TABLE IF EXISTS course_enquiry_events, course_enquiries;
ALTER TABLE clients DROP COLUMN IF EXISTS programme;
