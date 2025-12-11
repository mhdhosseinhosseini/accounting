-- 0012_remove_bank_name_from_bank_accounts.sql
-- Drop the redundant bank_name column from bank_accounts.
-- We keep bank_id and compute labels via join in API responses.

ALTER TABLE IF EXISTS bank_accounts
  DROP COLUMN IF EXISTS bank_name;