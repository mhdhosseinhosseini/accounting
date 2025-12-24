-- 0020_remove_legacy_tables.sql
-- Purpose: Drop legacy/unused tables from the accounting schema per request.
-- NOTE: This will remove dependent foreign keys via CASCADE. Review before applying.
-- فارسی: این مهاجرت جدول‌های قدیمی/غیرضروری را از اسکیمای حسابداری حذف می‌کند.

BEGIN;

-- Ensure we operate within the accounting schema context
SET search_path TO "accounting", public;

-- Drop in safe order with IF EXISTS to avoid errors across environments
DROP TABLE IF EXISTS accounting.inventory_transactions CASCADE;
DROP TABLE IF EXISTS accounting.invoice_items CASCADE;
DROP TABLE IF EXISTS accounting.invoices CASCADE;
DROP TABLE IF EXISTS accounting.warehouses CASCADE;
DROP TABLE IF EXISTS accounting.products CASCADE;
DROP TABLE IF EXISTS accounting.parties CASCADE;
DROP TABLE IF EXISTS accounting.accounts CASCADE;
DROP TABLE IF EXISTS accounting.treasury_receipts CASCADE;
DROP TABLE IF EXISTS accounting.treasury_payments CASCADE;

COMMIT;