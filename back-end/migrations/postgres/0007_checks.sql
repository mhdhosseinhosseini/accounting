-- Migration: Add checks table and indexes for cheque lifecycle management

-- Create checks table
CREATE TABLE IF NOT EXISTS checks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('incoming','outgoing')),
  receipt_id TEXT REFERENCES treasury_receipts(id) ON DELETE SET NULL,
  payment_id TEXT REFERENCES treasury_payments(id) ON DELETE SET NULL,
  number TEXT NOT NULL,
  bank_name TEXT,
  issuer TEXT,
  beneficiary TEXT,
  issue_date TIMESTAMPTZ NOT NULL,
  due_date TIMESTAMPTZ,
  amount NUMERIC(18,2) NOT NULL,
  currency TEXT DEFAULT 'IRR' NOT NULL,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','deposited','cleared','returned')),
  deposit_date TIMESTAMPTZ,
  deposit_bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL,
  clear_date TIMESTAMPTZ,
  return_date TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for reporting and lookups
CREATE INDEX IF NOT EXISTS idx_checks_status ON checks(status);
CREATE INDEX IF NOT EXISTS idx_checks_due_date ON checks(due_date);
CREATE INDEX IF NOT EXISTS idx_checks_receipt ON checks(receipt_id);
CREATE INDEX IF NOT EXISTS idx_checks_payment ON checks(payment_id);
CREATE INDEX IF NOT EXISTS idx_checks_deposit_bank ON checks(deposit_bank_account_id);