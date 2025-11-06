-- 0002_indexes.sql — Essential indexes for Phase 2 (Postgres)

BEGIN;

-- Accounts
CREATE INDEX IF NOT EXISTS idx_accounts_parent_id ON accounts(parent_id);
CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(type);

-- Journals
CREATE INDEX IF NOT EXISTS idx_journals_fiscal_year_id ON journals(fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_journals_date ON journals(date);
CREATE INDEX IF NOT EXISTS idx_journals_status ON journals(status);

-- Journal Items
CREATE INDEX IF NOT EXISTS idx_journal_items_journal_id ON journal_items(journal_id);
CREATE INDEX IF NOT EXISTS idx_journal_items_account_id ON journal_items(account_id);
CREATE INDEX IF NOT EXISTS idx_journal_items_party_id ON journal_items(party_id);

-- Parties
CREATE INDEX IF NOT EXISTS idx_parties_name ON parties(name);

-- Products
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

-- Invoices
CREATE INDEX IF NOT EXISTS idx_invoices_fiscal_year_id ON invoices(fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

-- Inventory Transactions
CREATE INDEX IF NOT EXISTS idx_inventory_tx_product_id ON inventory_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_warehouse_id ON inventory_transactions(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_date ON inventory_transactions(date);

-- Payments
CREATE INDEX IF NOT EXISTS idx_payments_party_id ON payments(party_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);

COMMIT;