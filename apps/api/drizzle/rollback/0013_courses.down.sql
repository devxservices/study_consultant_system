-- Undo 0013: courses and test preparation.
-- Refuses while any course, enrolment or official result recorded in the app
-- exists. Results copied from student profiles by the migration are dropped
-- with the table; the profiles themselves still hold those scores.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM courses) OR EXISTS (SELECT 1 FROM enrollments) THEN
    RAISE EXCEPTION 'Courses or enrolments exist.';
  END IF;
  IF EXISTS (SELECT 1 FROM test_results WHERE notes IS DISTINCT FROM 'Copied from the student''s profile when courses were added.') THEN
    RAISE EXCEPTION 'Official test results were recorded in the app.';
  END IF;
END $$;

DROP TABLE IF EXISTS homework_submissions, homework, assessment_scores, assessments, attendance, enrollments,
  class_sessions, batch_trainers, batches, courses, test_results, course_settings;
