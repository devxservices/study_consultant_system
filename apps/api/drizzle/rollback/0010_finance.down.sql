-- Undo 0010: the finance module (journal, taxes, quotes, credit notes,
-- installments, proofs, online payments, refunds, expenses, bills, bank).
-- Refuses while anything exists that the old invoice and payment tables
-- cannot express: a discounted or taxed invoice, one awaiting approval, a
-- credit note, a quote, an expense, a bill, an approved refund request or a
-- manual journal entry. The journal for plain invoices and payments is
-- derived from them, so dropping it loses nothing they do not hold.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE discount_total <> 0 OR tax_total <> 0 OR status = 'pending_approval') THEN
    RAISE EXCEPTION 'Invoices with discounts, tax or awaiting approval exist.';
  END IF;
  IF EXISTS (SELECT 1 FROM credit_notes) OR EXISTS (SELECT 1 FROM quotes) OR EXISTS (SELECT 1 FROM expenses)
     OR EXISTS (SELECT 1 FROM bills) OR EXISTS (SELECT 1 FROM day_closes) THEN
    RAISE EXCEPTION 'Credit notes, quotes, expenses, bills or cash counts exist.';
  END IF;
  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_type NOT IN ('invoice', 'invoice_void', 'payment', 'payment_void')) THEN
    RAISE EXCEPTION 'Journal entries other than invoices and payments exist.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS journal_entries_period_lock ON journal_entries;
DROP TRIGGER IF EXISTS journal_entries_balanced ON journal_entries;
DROP TRIGGER IF EXISTS journal_lines_balanced ON journal_lines;
DROP TRIGGER IF EXISTS journal_entries_immutable ON journal_entries;
DROP TRIGGER IF EXISTS journal_lines_immutable ON journal_lines;
DROP FUNCTION IF EXISTS journal_period_lock();
DROP FUNCTION IF EXISTS journal_entry_balanced();
DROP FUNCTION IF EXISTS journal_immutable();

DROP TABLE IF EXISTS finance_reminders, day_closes, bank_lines, bank_imports, refund_requests, online_payments,
  payment_submissions, credit_notes, installments, quotes, bills, expenses, journal_lines, journal_entries;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_account_id_ledger_accounts_id_fk;
ALTER TABLE payments DROP COLUMN IF EXISTS account_id, DROP COLUMN IF EXISTS fx_rate;
ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS invoice_items_tax_rate_id_tax_rates_id_fk;
ALTER TABLE invoice_items
  DROP COLUMN IF EXISTS category, DROP COLUMN IF EXISTS discount, DROP COLUMN IF EXISTS tax_rate_id,
  DROP COLUMN IF EXISTS tax_rate_name, DROP COLUMN IF EXISTS tax_rate_bp, DROP COLUMN IF EXISTS tax_inclusive,
  DROP COLUMN IF EXISTS tax_amount, DROP COLUMN IF EXISTS line_total;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_promo_code_id_promo_codes_id_fk;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_approved_by_users_id_fk;
DROP INDEX IF EXISTS invoices_parent_idx;
ALTER TABLE invoices
  DROP COLUMN IF EXISTS subtotal, DROP COLUMN IF EXISTS discount_total, DROP COLUMN IF EXISTS tax_total,
  DROP COLUMN IF EXISTS promo_code_id, DROP COLUMN IF EXISTS discount_reason, DROP COLUMN IF EXISTS fx_rate,
  DROP COLUMN IF EXISTS quote_id, DROP COLUMN IF EXISTS parent_invoice_id, DROP COLUMN IF EXISTS late_fee_invoice_id,
  DROP COLUMN IF EXISTS approved_by, DROP COLUMN IF EXISTS approved_at;
ALTER TABLE service_packages DROP CONSTRAINT IF EXISTS service_packages_tax_rate_id_tax_rates_id_fk;
ALTER TABLE service_packages DROP COLUMN IF EXISTS category, DROP COLUMN IF EXISTS tax_rate_id;

DROP TABLE IF EXISTS promo_codes, tax_rates, ledger_accounts, finance_settings;

UPDATE staff_roles SET effects = effects - 'billing.approve' WHERE system_key = 'senior';
-- 'pending_approval' stays in the invoice_status enum (values cannot be removed); nothing uses it.
