-- 0004_journal_code.sql — Add document code to journals

BEGIN;

-- Add a new nullable code field to journals distinct from ref_no
ALTER TABLE journals ADD COLUMN IF NOT EXISTS code TEXT;

-- Optional index to speed up search/sort by code
CREATE INDEX IF NOT EXISTS idx_journals_code ON journals(code);

COMMIT;