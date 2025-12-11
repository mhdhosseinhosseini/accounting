-- Extend bank_accounts with new fields and rename code to account_number
BEGIN;

-- Rename column code -> account_number if not already renamed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bank_accounts' AND column_name = 'code'
  ) THEN
    EXECUTE 'ALTER TABLE bank_accounts RENAME COLUMN code TO account_number';
  END IF;
END $$;

-- Add kind_of_account
ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS kind_of_account TEXT;

-- Add card_number
ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS card_number TEXT;

-- Add starting_amount and starting_date
ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS starting_amount NUMERIC(18,2) DEFAULT 0 NOT NULL;

ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS starting_date TIMESTAMPTZ DEFAULT NOW() NOT NULL;

COMMIT;