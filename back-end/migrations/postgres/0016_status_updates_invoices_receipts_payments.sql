-- Migration 0016: Normalize invoices/receipts/payments statuses to temporary/permanent
-- English: Update default statuses and migrate existing data for invoices, receipts, and payments
-- فارسی: به‌روزرسانی مقدار پیش‌فرض وضعیت‌ها و مهاجرت داده‌های موجود برای فاکتورها، رسیدها و پرداخت‌ها

BEGIN;

-- Receipts: change default and constraint; migrate existing rows
ALTER TABLE receipts ALTER COLUMN status SET DEFAULT 'temporary';
-- Drop old check constraint if present (draft/posted/canceled)
ALTER TABLE receipts DROP CONSTRAINT IF EXISTS receipts_status_check;
-- Add new constraint allowing temporary/permanent/canceled
ALTER TABLE receipts ADD CONSTRAINT receipts_status_check CHECK (status IN ('temporary','permanent','canceled'));
-- Data migration
UPDATE receipts SET status = 'temporary' WHERE status = 'draft';
UPDATE receipts SET status = 'permanent' WHERE status = 'posted';

-- Invoices: change default; migrate existing rows
ALTER TABLE invoices ALTER COLUMN status SET DEFAULT 'temporary';
UPDATE invoices SET status = 'temporary' WHERE status = 'draft';
UPDATE invoices SET status = 'permanent' WHERE status = 'posted';

-- Payments: ensure status column exists and default; migrate existing rows
ALTER TABLE payments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'temporary';
ALTER TABLE payments ALTER COLUMN status SET DEFAULT 'temporary';
UPDATE payments SET status = 'temporary' WHERE status = 'draft';
UPDATE payments SET status = 'permanent' WHERE status = 'posted';

COMMIT;