-- Undo 0016: platform settings, subscription payments, renewal reminders.
-- The paid-until date itself (tenants.current_period_end) is older and stays.
-- Dropping subscription_payments loses the record of what each consultancy
-- paid the platform: export it first if it matters.

DROP TABLE IF EXISTS subscription_payments;
DROP TABLE IF EXISTS platform_settings;
ALTER TABLE tenants DROP COLUMN IF EXISTS renewal_notice_key;
