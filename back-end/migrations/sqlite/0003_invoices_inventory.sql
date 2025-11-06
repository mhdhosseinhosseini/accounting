-- Phase 4: Invoicing & Inventory Integration (SQLite)
-- Creates invoices, invoice_items, and inventory_transactions tables.

BEGIN TRANSACTION;

-- Invoices table (aligned with ensureSchema)
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  invoice_no TEXT UNIQUE,
  fiscal_year_id TEXT,
  customer_id TEXT,
  date DATETIME NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  total REAL NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years(id) ON DELETE SET NULL,
  FOREIGN KEY(customer_id) REFERENCES parties(id) ON DELETE SET NULL
);

-- Invoice items table (aligned with ensureSchema)
CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  product_id TEXT,
  quantity REAL NOT NULL DEFAULT 0,
  unit_price REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL
);

-- Inventory transactions table (aligned with ensureSchema)
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  quantity REAL NOT NULL,
  type TEXT NOT NULL,
  date DATETIME NOT NULL,
  reference TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE RESTRICT,
  FOREIGN KEY(warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT
);

COMMIT;