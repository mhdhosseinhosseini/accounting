-- 0005_journal_serial.sql — Add sequential serial number to journals

BEGIN;

-- Create sequence for journals serial numbers starting at 1
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'journals_serial_seq') THEN
    CREATE SEQUENCE journals_serial_seq START 1;
  END IF;
END$$;

-- Add column and set default from sequence
ALTER TABLE journals ADD COLUMN IF NOT EXISTS serial_no INTEGER;
ALTER TABLE journals ALTER COLUMN serial_no SET DEFAULT nextval('journals_serial_seq');

-- Backfill existing rows with sequential numbers ordered by creation time
WITH s AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn FROM journals
)
UPDATE journals j SET serial_no = s.rn
FROM s
WHERE j.id = s.id AND j.serial_no IS NULL;

-- Advance sequence to max(current serial) so next insert continues correctly
SELECT setval('journals_serial_seq', (SELECT COALESCE(MAX(serial_no), 0) FROM journals));

-- Ensure uniqueness and fast lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_journals_serial_no ON journals(serial_no);

COMMIT;