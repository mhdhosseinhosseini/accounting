-- Add CHECK constraint to allow 'temporary', 'permanent', and 'draft' statuses on journals
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'journals_status_check'
  ) THEN
    ALTER TABLE journals ADD CONSTRAINT journals_status_check CHECK (status IN ('temporary','permanent','draft'));
  END IF;
END $$;

COMMIT;