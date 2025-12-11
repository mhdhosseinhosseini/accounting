-- Migration 0015: Normalize journal statuses to temporary/permanent
-- English: Change journals default status to 'temporary' and migrate existing rows
-- Persian: تغییر وضعیت‌های اسناد روزنامه به «موقت/دائمی» و تنظیم مقدار پیش‌فرض

BEGIN;

-- Set default status to temporary for new journals
ALTER TABLE journals ALTER COLUMN status SET DEFAULT 'temporary';

-- Migrate existing draft journals to temporary
UPDATE journals SET status = 'temporary' WHERE status = 'draft';

-- Migrate existing posted journals to permanent
UPDATE journals SET status = 'permanent' WHERE status = 'posted';

COMMIT;