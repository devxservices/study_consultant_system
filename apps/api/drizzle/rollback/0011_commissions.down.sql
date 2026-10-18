-- Undo 0011: university commissions and the institution catalogue.
-- Refuses while there is anything the free-text university fields cannot
-- hold: a commission, a claim, a receipt from an institution, or an
-- agreement. Applications keep target_university, so unlinking them loses
-- nothing; tuition, scholarship and course start are dropped with the
-- columns, so it refuses while any are set too.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM commissions) OR EXISTS (SELECT 1 FROM commission_claims)
     OR EXISTS (SELECT 1 FROM institution_receipts) OR EXISTS (SELECT 1 FROM commission_agreements) THEN
    RAISE EXCEPTION 'Commissions, claims, receipts or agreements exist.';
  END IF;
  IF EXISTS (SELECT 1 FROM cases WHERE tuition_fee IS NOT NULL OR scholarship IS NOT NULL OR course_start IS NOT NULL) THEN
    RAISE EXCEPTION 'Applications have tuition, scholarship or course start dates recorded.';
  END IF;
  IF EXISTS (SELECT 1 FROM journal_lines l JOIN ledger_accounts a ON a.id = l.account_id WHERE a.system_key IN ('staff_incentives', 'bad_debts')) THEN
    RAISE EXCEPTION 'The staff incentives or bad debts accounts have entries.';
  END IF;
END $$;

ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_institution_id_institutions_id_fk;
ALTER TABLE cases
  DROP COLUMN IF EXISTS institution_id, DROP COLUMN IF EXISTS tuition_fee, DROP COLUMN IF EXISTS tuition_currency,
  DROP COLUMN IF EXISTS scholarship, DROP COLUMN IF EXISTS course_start;

DROP TABLE IF EXISTS commission_splits, receipt_allocations, institution_receipts, commissions, commission_claims,
  commission_rules, commission_agreements, institution_contacts, institutions, commission_settings;

DELETE FROM ledger_accounts WHERE system_key IN ('staff_incentives', 'bad_debts');
