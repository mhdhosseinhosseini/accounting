-- 0006_detail_level_specific_codes.sql
-- Introduce join table to support multiple specific codes per detail level.
-- Drop legacy specific_code_id column and constraint from detail_levels.

BEGIN;

-- Create join table for detail_levels ↔ codes (many-to-many)
CREATE TABLE IF NOT EXISTS detail_level_specific_codes (
  detail_level_id TEXT NOT NULL REFERENCES detail_levels(id) ON DELETE CASCADE,
  code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (detail_level_id, code_id)
);

-- Helpful indexes for lookups (redundant to PK but explicit)
CREATE INDEX IF NOT EXISTS idx_dls_codes_level ON detail_level_specific_codes(detail_level_id);
CREATE INDEX IF NOT EXISTS idx_dls_codes_code ON detail_level_specific_codes(code_id);

-- Backfill existing singular linkage into the new join table
INSERT INTO detail_level_specific_codes (detail_level_id, code_id)
SELECT id, specific_code_id FROM detail_levels WHERE specific_code_id IS NOT NULL
ON CONFLICT (detail_level_id, code_id) DO NOTHING;

-- Drop root-specific constraint if present
ALTER TABLE IF EXISTS detail_levels DROP CONSTRAINT IF EXISTS detail_levels_root_specific;

-- Drop legacy column from detail_levels
ALTER TABLE IF EXISTS detail_levels DROP COLUMN IF EXISTS specific_code_id;

COMMIT;