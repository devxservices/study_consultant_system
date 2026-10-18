-- Undo 0012: partner consultants.
-- Refuses while any partner exists: its students' attribution, earnings,
-- payouts and agreements would be lost. The 'partners' value added to the
-- announcement audience stays (Postgres cannot remove an enum value without
-- rebuilding the type); nothing uses it once announcements to partners are gone.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM partners) THEN
    RAISE EXCEPTION 'Partners exist.';
  END IF;
  IF EXISTS (SELECT 1 FROM announcements WHERE audience = 'partners') THEN
    RAISE EXCEPTION 'Announcements to partners exist.';
  END IF;
  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_type IN ('partner_earning', 'partner_advance', 'payout')) THEN
    RAISE EXCEPTION 'Partner money is in the books.';
  END IF;
END $$;

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_partner_id_partners_id_fk;
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_partner_registered_by_users_id_fk;
DROP INDEX IF EXISTS clients_partner_idx;
ALTER TABLE clients DROP COLUMN IF EXISTS partner_id, DROP COLUMN IF EXISTS partner_attributed_at, DROP COLUMN IF EXISTS partner_registered_by;

DROP TABLE IF EXISTS advance_recoveries, partner_advances, partner_earnings, payouts, partner_messages, attribution_conflicts,
  partner_rules, partner_agreements, partner_documents, partner_members, partner_settings, partners;
