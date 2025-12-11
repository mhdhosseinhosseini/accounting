-- 0018_bank_accounts_handler_detail_id.sql
-- Adds handler_detail_id to bank_accounts, referencing details(id)
-- Ensures referential integrity and allows NULL (set NULL on delete)

BEGIN;

ALTER TABLE IF EXISTS bank_accounts
  ADD COLUMN IF NOT EXISTS handler_detail_id TEXT REFERENCES details(id) ON DELETE SET NULL;

-- Optional index to speed up lookups by handler_detail_id
CREATE INDEX IF NOT EXISTS idx_bank_accounts_handler_detail_id ON bank_accounts(handler_detail_id);

COMMIT;