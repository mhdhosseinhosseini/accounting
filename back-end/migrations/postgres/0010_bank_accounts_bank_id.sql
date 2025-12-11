-- Add relation from bank_accounts to banks via bank_id
-- Also keep existing bank_name for backward compatibility.

BEGIN;

-- Add bank_id column if missing and create index
ALTER TABLE IF EXISTS bank_accounts
  ADD COLUMN IF NOT EXISTS bank_id TEXT REFERENCES banks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bank_accounts_bank_id ON bank_accounts(bank_id);

COMMIT;