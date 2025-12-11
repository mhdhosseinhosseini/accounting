-- 0019_receipts_journal_id.sql
-- Adds a nullable link from receipts to journals to indicate a document created from a receipt.
-- Also creates an index for faster lookups.

ALTER TABLE IF EXISTS receipts
  ADD COLUMN IF NOT EXISTS journal_id TEXT REFERENCES journals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_receipts_journal ON receipts(journal_id);