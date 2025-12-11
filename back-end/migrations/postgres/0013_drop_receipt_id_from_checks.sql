-- 0013_drop_receipt_id_from_checks.sql
-- English: Drop deprecated receipt_id column and related index from checks.
-- فارسی: حذف ستون منقضی‌شده receipt_id و ایندکس مرتبط از جدول checks.

BEGIN;

-- Drop index referencing receipt_id if present
DROP INDEX IF EXISTS idx_checks_receipt;

-- Drop receipt_id column from checks table
ALTER TABLE IF EXISTS checks DROP COLUMN IF EXISTS receipt_id;

COMMIT;