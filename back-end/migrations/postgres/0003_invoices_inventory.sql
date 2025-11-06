-- Phase 4: Invoicing & Inventory Integration (Postgres)
-- Creates invoices, invoice_items, and inventory_transactions tables.

BEGIN;

-- Invoices table (aligned with SQLite ensureSchema)
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY,
  invoice_no TEXT UNIQUE,
  fiscal_year_id UUID REFERENCES fiscal_years(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES parties(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  total NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Invoice items table (aligned with SQLite ensureSchema)
CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Inventory transactions table (aligned with SQLite ensureSchema)
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id UUID PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL,
  type TEXT NOT NULL,
  date DATE NOT NULL,
  reference TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;