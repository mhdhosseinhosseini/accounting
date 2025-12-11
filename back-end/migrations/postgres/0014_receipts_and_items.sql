-- 0014_receipts_and_items.sql
-- English: Define unified receipts and receipt_items tables for Treasury receipts.
-- فارسی: تعریف جداول یکپارچه رسیدها و اقلام رسید برای خزانه‌داری.

BEGIN;

-- Receipts: header for money receipt document
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  number TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','canceled')),
  date TIMESTAMPTZ NOT NULL,
  fiscal_year_id TEXT REFERENCES fiscal_years(id) ON DELETE SET NULL,
  party_id TEXT REFERENCES parties(id) ON DELETE SET NULL,
  description TEXT,
  total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Receipt Items: detail lines with instrument-specific fields
CREATE TABLE IF NOT EXISTS receipt_items (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  instrument_type TEXT NOT NULL CHECK (instrument_type IN ('cash','card','transfer','check')),
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  -- Destinations
  cashbox_id TEXT REFERENCES cashboxes(id) ON DELETE RESTRICT,
  bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  -- References for reconciliation
  card_ref TEXT,
  transfer_ref TEXT,
  -- Link to an existing check (incoming). Amount may mirror check amount.
  check_id TEXT REFERENCES checks(id) ON DELETE RESTRICT,
  -- Destination for check: cashbox or bank (runtime rule)
  destination_type TEXT CHECK (destination_type IN ('cashbox','bank')),
  destination_id TEXT,
  -- Position for UI ordering
  position INT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes to support common lookups
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(date);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status);
CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_instrument ON receipt_items(instrument_type);
CREATE INDEX IF NOT EXISTS idx_receipt_items_bank ON receipt_items(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_cashbox ON receipt_items(cashbox_id);

-- Unique refs for card and transfer when provided
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_items_card_ref ON receipt_items(card_ref) WHERE card_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_items_transfer_ref ON receipt_items(transfer_ref) WHERE transfer_ref IS NOT NULL;

COMMIT;