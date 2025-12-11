-- Add starting amount and starting date fields to cashboxes
BEGIN;

ALTER TABLE cashboxes
  ADD COLUMN IF NOT EXISTS starting_amount NUMERIC(18,2) DEFAULT 0 NOT NULL;

ALTER TABLE cashboxes
  ADD COLUMN IF NOT EXISTS starting_date TIMESTAMPTZ DEFAULT NOW() NOT NULL;

COMMIT;