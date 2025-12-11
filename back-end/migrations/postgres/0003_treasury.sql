-- Treasury schema migration
-- Removes legacy payments table and introduces treasury-specific tables.
-- Includes indexes for common queries.

BEGIN;

-- Drop legacy payments table if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'payments'
  ) THEN
    EXECUTE 'DROP TABLE payments CASCADE';
  END IF;
END $$;

-- Cashboxes: master data for physical cash repositories
CREATE TABLE IF NOT EXISTS cashboxes (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Bank accounts: master data for bank repositories
CREATE TABLE IF NOT EXISTS bank_accounts (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  iban TEXT,
  bank_name TEXT,
  is_active BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Receipts: money coming into cashbox
CREATE TABLE IF NOT EXISTS treasury_receipts (
  id TEXT PRIMARY KEY,
  cashbox_id TEXT NOT NULL REFERENCES cashboxes(id) ON DELETE RESTRICT,
  fiscal_year_id TEXT REFERENCES fiscal_years(id) ON DELETE SET NULL,
  party_id TEXT REFERENCES parties(id) ON DELETE SET NULL,
  amount NUMERIC(18,2) NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Payments: money leaving cashbox or bank
CREATE TABLE IF NOT EXISTS treasury_payments (
  id TEXT PRIMARY KEY,
  cashbox_id TEXT REFERENCES cashboxes(id) ON DELETE RESTRICT,
  bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL,
  fiscal_year_id TEXT REFERENCES fiscal_years(id) ON DELETE SET NULL,
  party_id TEXT REFERENCES parties(id) ON DELETE SET NULL,
  amount NUMERIC(18,2) NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  method TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Cash register entries: combined ledger of receipts and payments
CREATE TABLE IF NOT EXISTS cash_register_entries (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL, -- 'receipt' or 'payment'
  source_id TEXT, -- id of treasury_receipts or treasury_payments
  cashbox_id TEXT REFERENCES cashboxes(id) ON DELETE RESTRICT,
  bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL,
  amount NUMERIC(18,2) NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes to speed up queries
CREATE INDEX IF NOT EXISTS idx_treasury_receipts_cashbox ON treasury_receipts(cashbox_id);
CREATE INDEX IF NOT EXISTS idx_treasury_receipts_date ON treasury_receipts(date);
CREATE INDEX IF NOT EXISTS idx_treasury_payments_cashbox ON treasury_payments(cashbox_id);
CREATE INDEX IF NOT EXISTS idx_treasury_payments_bank ON treasury_payments(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_treasury_payments_date ON treasury_payments(date);
CREATE INDEX IF NOT EXISTS idx_cash_register_entries_date ON cash_register_entries(date);
CREATE INDEX IF NOT EXISTS idx_cash_register_entries_cashbox ON cash_register_entries(cashbox_id);
CREATE INDEX IF NOT EXISTS idx_cash_register_entries_bank ON cash_register_entries(bank_account_id);

COMMIT;