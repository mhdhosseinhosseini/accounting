import { Pool } from 'pg';
import { randomUUID } from 'crypto';

let pool: Pool | null = null;
let schemaReady = false;

/**
 * Database schema namespace used by the accounting backend.
 * Defaults to 'accounting' but can be overridden via env ACCOUNTING_SCHEMA.
 */
const DEFAULT_SCHEMA = process.env.ACCOUNTING_SCHEMA || 'accounting';

/**
 * Get or initialize a singleton Postgres pool.
 * Returns the active pool instance.
 */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    // Allow enabling SSL via env for cloud providers (e.g., Liara, Heroku)
    const enableSsl = String(process.env.PG_SSL || process.env.PGSSL || '').toLowerCase() === 'true'
      || String(process.env.PGSSLMODE || '').toLowerCase() === 'require';
    const config: any = { connectionString };
    if (enableSsl) {
      config.ssl = { rejectUnauthorized: false };
    }
    pool = new Pool(config);

    /**
     * Ensure each new connection uses the accounting schema via search_path.
     * Also creates the schema if it does not exist yet (idempotent).
     */
    const schema = DEFAULT_SCHEMA;
    pool.on('connect', async (client: any) => {
      try {
        await client.query(`SET search_path TO "${schema}", public`);
      } catch (e) {
        console.error('Failed to set search_path:', e);
      }
    });
  }
  return pool;
}

/**
 * Ensure database schema for Phase 1+2.
 * - Creates authentication tables and core accounting tables if missing.
 * - Safe to call multiple times; uses IF NOT EXISTS and idempotent constraints.
 */
export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  const p = getPool();

  /**
   * Create and switch to the accounting schema to avoid collisions
   * with existing public tables (e.g., users with bigint ids).
   */
  const schema = DEFAULT_SCHEMA;
  await p.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await p.query(`SET search_path TO "${schema}", public`);

  // Phase 1 tables (existing)
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      mobile_number TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      revoked BOOLEAN DEFAULT FALSE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  // Phase 2 core tables
  await p.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      assigned_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      UNIQUE (user_id, role_id)
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS fiscal_years (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      is_closed BOOLEAN DEFAULT FALSE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  // Accounts table removed; journal_items now references codes instead of accounts.

  // Details: global 4-digit codes, unique, no prefix
  await p.query(`
    CREATE TABLE IF NOT EXISTS details (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      is_active BOOLEAN DEFAULT TRUE NOT NULL,
      kind BOOLEAN DEFAULT TRUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  // Ensure legacy DBs have the new 'kind' column
  await p.query(`ALTER TABLE IF EXISTS details ADD COLUMN IF NOT EXISTS kind BOOLEAN DEFAULT TRUE NOT NULL`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS detail_levels (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      parent_id TEXT REFERENCES detail_levels(id) ON DELETE SET NULL,
      is_active BOOLEAN DEFAULT TRUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  // Harden legacy table to include required columns
  await p.query(`ALTER TABLE IF EXISTS detail_levels ADD COLUMN IF NOT EXISTS code TEXT`);
  await p.query(`ALTER TABLE IF EXISTS detail_levels ADD COLUMN IF NOT EXISTS title TEXT`);
  // Removed legacy specific_code_id column; associations now live in detail_level_specific_codes
  await p.query(`ALTER TABLE IF EXISTS detail_levels ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE NOT NULL`);
  await p.query(`ALTER TABLE IF EXISTS detail_levels ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL`);

  // Ensure parent_id column and its index exist (simpler, resilient on legacy DBs)
  await p.query(`ALTER TABLE IF EXISTS detail_levels ADD COLUMN IF NOT EXISTS parent_id TEXT`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_detail_levels_parent ON detail_levels(parent_id)`);
  await p.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname='fk_detail_levels_parent'
      ) THEN
        EXECUTE 'ALTER TABLE detail_levels ADD CONSTRAINT fk_detail_levels_parent FOREIGN KEY (parent_id) REFERENCES detail_levels(id) ON DELETE SET NULL';
      END IF;
    END $$;
  `);

  // Join table: details ↔ detail_levels (many-to-many)
  // - Blocks deletes via RESTRICT to preserve reporting integrity
  // - Supports optional primary and ordering for future reports
  await p.query(`
    CREATE TABLE IF NOT EXISTS details_detail_levels (
      detail_id TEXT NOT NULL REFERENCES details(id) ON DELETE RESTRICT,
      detail_level_id TEXT NOT NULL REFERENCES detail_levels(id) ON DELETE RESTRICT,
      is_primary BOOLEAN DEFAULT FALSE NOT NULL,
      position INT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      PRIMARY KEY (detail_id, detail_level_id)
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_details_detail_levels_detail ON details_detail_levels(detail_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_details_detail_levels_level ON details_detail_levels(detail_level_id)`);

  // Specific codes per detail level: codes ↔ detail_levels (many-to-many)
  // Newer schemas use this instead of legacy specific_code_id on detail_levels
  await p.query(`
    CREATE TABLE IF NOT EXISTS detail_level_specific_codes (
      detail_level_id TEXT NOT NULL REFERENCES detail_levels(id) ON DELETE CASCADE,
      code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      PRIMARY KEY (detail_level_id, code_id)
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_detail_level_specific_codes_level ON detail_level_specific_codes(detail_level_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_detail_level_specific_codes_code ON detail_level_specific_codes(code_id)`);

  // Backfill from legacy detail_levels.specific_code_id, then drop the column
  try {
    const existsSpecific = await p.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'detail_levels' AND column_name = 'specific_code_id'
       ) AS exists`
    );
    const hasSpecific = !!(existsSpecific.rows[0] && existsSpecific.rows[0].exists);
    if (hasSpecific) {
      await p.query(`
        INSERT INTO detail_level_specific_codes (detail_level_id, code_id)
        SELECT id, specific_code_id
        FROM detail_levels
        WHERE specific_code_id IS NOT NULL
        ON CONFLICT DO NOTHING
      `);
      await p.query(`ALTER TABLE IF EXISTS detail_levels DROP CONSTRAINT IF EXISTS detail_levels_root_specific`);
      await p.query(`ALTER TABLE IF EXISTS detail_levels DROP COLUMN IF EXISTS specific_code_id`);
    }
  } catch {
    // Ignore if clean or column absent
  }

  // Explicit migration: move legacy code_id values into specific_code_id and drop code_id
  try {
    const existsProbe = await p.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'detail_levels' AND column_name = 'code_id'
       ) AS exists`
    );
    const hasCodeId = !!(existsProbe.rows[0] && existsProbe.rows[0].exists);
    if (hasCodeId) {
      await p.query(`UPDATE detail_levels SET specific_code_id = COALESCE(specific_code_id, code_id) WHERE code_id IS NOT NULL`);
      await p.query(`ALTER TABLE IF EXISTS detail_levels DROP COLUMN IF EXISTS code_id`);
    }
  } catch {
    // Swallow migration error to avoid boot failure on clean DBs
  }
  
  // Explicit migration: drop legacy detail_id column if present
  try {
    const detailIdProbe = await p.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'detail_levels' AND column_name = 'detail_id'
       ) AS exists`
    );
    const hasDetailId = !!(detailIdProbe.rows[0] && detailIdProbe.rows[0].exists);
    if (hasDetailId) {
      // Make nullable first to avoid dependency errors, then drop
      await p.query(`ALTER TABLE IF EXISTS detail_levels ALTER COLUMN detail_id DROP NOT NULL`);
      await p.query(`ALTER TABLE IF EXISTS detail_levels DROP COLUMN IF EXISTS detail_id`);
    }
  } catch {
    // Ignore if clean
  }
  
  // Migration block for legacy schemas
  await p.query(`
    DO $$
    BEGIN
      -- Drop legacy level column
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='detail_levels' AND column_name='level'
      ) THEN
        EXECUTE 'ALTER TABLE detail_levels DROP COLUMN level';
      END IF;

      -- Ensure updated_at column exists
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='detail_levels' AND column_name='updated_at'
      ) THEN
        EXECUTE 'ALTER TABLE detail_levels ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL';
      END IF;
    END $$;
  `);

  // Codes: two-level General → Specific tree with optional parent
  await p.query(`
    CREATE TABLE IF NOT EXISTS codes (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      parent_id TEXT REFERENCES codes(id) ON DELETE SET NULL,
      is_active BOOLEAN DEFAULT TRUE NOT NULL,
      nature INT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  // Ensure legacy databases also have the 'nature' column
  await p.query(`ALTER TABLE IF EXISTS codes ADD COLUMN IF NOT EXISTS nature INT`);
  // Add can_have_details toggle column for specific codes; default true
  await p.query(`ALTER TABLE IF EXISTS codes ADD COLUMN IF NOT EXISTS can_have_details BOOLEAN DEFAULT TRUE NOT NULL`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS parties (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT UNIQUE,
      mobile TEXT,
      address TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT UNIQUE,
      price NUMERIC(18,2) DEFAULT 0 NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS warehouses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  // Cost centers: dedicated table
  await p.query(`
    CREATE TABLE IF NOT EXISTS cost_centers (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      is_active BOOLEAN DEFAULT TRUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  // Settings: generic key-value configurations (code, name, value)
  await p.query(`
    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      value JSONB,
      type TEXT,
      special_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_settings_code ON settings(code)`);
  // Ensure updated_at column exists on legacy DBs
  await p.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'settings' AND column_name = 'updated_at'
      ) THEN
        EXECUTE 'ALTER TABLE settings ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL';
      END IF;
    END $$;
  `);
  // Ensure special_id column exists on legacy DBs
  await p.query(`ALTER TABLE IF EXISTS settings ADD COLUMN IF NOT EXISTS special_id TEXT`);
  // Ensure type column exists on legacy DBs
  await p.query(`ALTER TABLE IF EXISTS settings ADD COLUMN IF NOT EXISTS type TEXT`);

  /**
   * Migration: rename legacy `kind` column to `special_code` in `settings` table.
   * Some older databases may have stored a `kind` marker; this block safely
   * renames it when present and ensures `special_code` column exists.
   */
  await p.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'settings' AND column_name = 'kind'
      ) THEN
        EXECUTE 'ALTER TABLE settings RENAME COLUMN kind TO special_code';
      END IF;
    END $$;
  `);
  await p.query(`ALTER TABLE IF EXISTS settings ADD COLUMN IF NOT EXISTS special_code TEXT`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS journals (
      id TEXT PRIMARY KEY,
      serial_no BIGINT GENERATED BY DEFAULT AS IDENTITY,
      fiscal_year_id TEXT REFERENCES fiscal_years(id) ON DELETE SET NULL,
      date TIMESTAMPTZ NOT NULL,
      ref_no TEXT,
      code TEXT,
      description TEXT,
      type TEXT,
      provider TEXT,
      status TEXT DEFAULT 'temporary' NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  // Ensure unique ref_no per fiscal year when not null
  await p.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_journals_fiscal_ref ON journals(fiscal_year_id, ref_no) WHERE ref_no IS NOT NULL;
  `);
  /**
   * journals: add type/provider columns
   * Adds optional TEXT columns to classify journals and track external provider source.
   * Safe migration: uses IF NOT EXISTS to avoid errors on repeated runs.
   */
  await p.query(`ALTER TABLE IF EXISTS journals ADD COLUMN IF NOT EXISTS type TEXT`);
  await p.query(`ALTER TABLE IF EXISTS journals ADD COLUMN IF NOT EXISTS provider TEXT`);
  // Ensure code/description/serial_no columns exist on legacy DBs
  await p.query(`ALTER TABLE IF EXISTS journals ADD COLUMN IF NOT EXISTS code TEXT`);
  await p.query(`ALTER TABLE IF EXISTS journals ADD COLUMN IF NOT EXISTS description TEXT`);
  await p.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='journals' AND column_name='serial_no'
      ) THEN
        EXECUTE 'ALTER TABLE journals ADD COLUMN serial_no BIGINT GENERATED BY DEFAULT AS IDENTITY';
      END IF;
    END $$;
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS journal_items (
      id TEXT PRIMARY KEY,
      journal_id TEXT NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
      code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE RESTRICT,
      detail_id TEXT REFERENCES details(id) ON DELETE RESTRICT,
      cost_center_id TEXT REFERENCES cost_centers(id) ON DELETE SET NULL,
      party_id TEXT REFERENCES parties(id) ON DELETE SET NULL,
      debit NUMERIC(18,2) DEFAULT 0 NOT NULL,
      credit NUMERIC(18,2) DEFAULT 0 NOT NULL,
      description TEXT
    );
  `);

  // Migrate legacy journal_items to add detail_id and cost_center_id with FKs if missing
  await p.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='journal_items' AND column_name='detail_id'
      ) THEN
        EXECUTE 'ALTER TABLE journal_items ADD COLUMN detail_id TEXT';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='journal_items' AND column_name='cost_center_id'
      ) THEN
        EXECUTE 'ALTER TABLE journal_items ADD COLUMN cost_center_id TEXT';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname='fk_journal_items_detail'
      ) THEN
        EXECUTE 'ALTER TABLE journal_items ADD CONSTRAINT fk_journal_items_detail FOREIGN KEY (detail_id) REFERENCES details(id) ON DELETE RESTRICT';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname='fk_journal_items_cost_center'
      ) THEN
        EXECUTE 'ALTER TABLE journal_items ADD CONSTRAINT fk_journal_items_cost_center FOREIGN KEY (cost_center_id) REFERENCES cost_centers(id) ON DELETE SET NULL';
      END IF;
    END $$;
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      invoice_no TEXT UNIQUE,
      fiscal_year_id TEXT REFERENCES fiscal_years(id) ON DELETE SET NULL,
      customer_id TEXT REFERENCES parties(id) ON DELETE SET NULL,
      date TIMESTAMPTZ NOT NULL,
      status TEXT DEFAULT 'temporary' NOT NULL,
      total NUMERIC(18,2) DEFAULT 0 NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS invoice_items (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
      quantity NUMERIC(18,3) DEFAULT 0 NOT NULL,
      unit_price NUMERIC(18,2) DEFAULT 0 NOT NULL,
      total NUMERIC(18,2) DEFAULT 0 NOT NULL
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
      quantity NUMERIC(18,3) NOT NULL,
      type TEXT NOT NULL,
      date TIMESTAMPTZ NOT NULL,
      reference TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  // Preserve legacy payments table; avoid destructive drop to protect data
  // Previously this initializer dropped the 'payments' table which erased data on restart.
  // We now keep existing data and rely on ALTER TABLE calls below to evolve schema safely.

  // Cashboxes: master data for physical cash repositories
  await p.query(`
    CREATE TABLE IF NOT EXISTS cashboxes (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      handler_detail_id TEXT REFERENCES details(id) ON DELETE SET NULL,
      is_active BOOLEAN DEFAULT TRUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);
  // Ensure columns exist for legacy DBs
  await p.query(`ALTER TABLE IF EXISTS cashboxes ADD COLUMN IF NOT EXISTS handler_detail_id TEXT REFERENCES details(id) ON DELETE SET NULL`);
  await p.query(`ALTER TABLE IF EXISTS cashboxes ADD COLUMN IF NOT EXISTS starting_amount NUMERIC(18,2) DEFAULT 0 NOT NULL`);
  await p.query(`ALTER TABLE IF EXISTS cashboxes ADD COLUMN IF NOT EXISTS starting_date TIMESTAMPTZ DEFAULT NOW() NOT NULL`);

  // Banks: master data for bank and branch definitions
  await p.query(`
    CREATE TABLE IF NOT EXISTS banks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      branch_number INT,
      branch_name TEXT,
      city TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_banks_branch_number ON banks(branch_number)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_banks_city ON banks(city)`);

  // Bank accounts: master data for bank repositories
  await p.query(`
    CREATE TABLE IF NOT EXISTS bank_accounts (
      id TEXT PRIMARY KEY,
      account_number TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      iban TEXT,
      bank_id TEXT REFERENCES banks(id) ON DELETE SET NULL,
      kind_of_account TEXT,
      card_number TEXT,
      starting_amount NUMERIC(18,2) DEFAULT 0 NOT NULL,
      starting_date TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      is_active BOOLEAN DEFAULT TRUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  // Ensure column rename for legacy DBs
  await p.query(`DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name = 'bank_accounts' AND column_name = 'code'
    ) THEN
      EXECUTE 'ALTER TABLE bank_accounts RENAME COLUMN code TO account_number';
    END IF;
  END $$;`);

  // Ensure columns exist for legacy DBs
  await p.query(`ALTER TABLE IF EXISTS bank_accounts ADD COLUMN IF NOT EXISTS kind_of_account TEXT`);
  await p.query(`ALTER TABLE IF EXISTS bank_accounts ADD COLUMN IF NOT EXISTS card_number TEXT`);
  await p.query(`ALTER TABLE IF EXISTS bank_accounts ADD COLUMN IF NOT EXISTS starting_amount NUMERIC(18,2) DEFAULT 0 NOT NULL`);
  await p.query(`ALTER TABLE IF EXISTS bank_accounts ADD COLUMN IF NOT EXISTS starting_date TIMESTAMPTZ DEFAULT NOW() NOT NULL`);
  await p.query(`ALTER TABLE IF EXISTS bank_accounts ADD COLUMN IF NOT EXISTS bank_id TEXT REFERENCES banks(id) ON DELETE SET NULL`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_bank_accounts_bank_id ON bank_accounts(bank_id)`);
// Remove deprecated bank_name column if it exists (we compute label via JOINs)
await p.query(`ALTER TABLE IF EXISTS bank_accounts DROP COLUMN IF EXISTS bank_name`);
// Ensure linking to Details via handler_detail_id exists
await p.query(`ALTER TABLE IF EXISTS bank_accounts ADD COLUMN IF NOT EXISTS handler_detail_id TEXT REFERENCES details(id) ON DELETE SET NULL`);


  // Receipts: money coming into cashbox (normalized header+items per OpenAPI)
  await p.query(`
    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      number TEXT,
      status TEXT DEFAULT 'temporary' NOT NULL,
      date TIMESTAMPTZ NOT NULL,
      fiscal_year_id TEXT REFERENCES fiscal_years(id) ON DELETE SET NULL,
      detail_id TEXT REFERENCES details(id) ON DELETE SET NULL,
      description TEXT,
      total_amount NUMERIC(18,2) DEFAULT 0 NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);
  // Ensure legacy column migration
  await p.query(`ALTER TABLE IF EXISTS receipts ADD COLUMN IF NOT EXISTS detail_id TEXT REFERENCES details(id) ON DELETE SET NULL`);
  await p.query(`ALTER TABLE IF EXISTS receipts DROP COLUMN IF EXISTS party_id`);
  // Add special code reference for receipts header
  await p.query(`ALTER TABLE IF EXISTS receipts ADD COLUMN IF NOT EXISTS special_code_id TEXT REFERENCES codes(id) ON DELETE SET NULL`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_receipts_special_code ON receipts(special_code_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(date)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_receipts_fiscal_year ON receipts(fiscal_year_id)`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_receipts_fiscal_number ON receipts(fiscal_year_id, number) WHERE number IS NOT NULL`);
  // Add header-level cashbox linkage for receipts
  await p.query(`ALTER TABLE IF EXISTS receipts ADD COLUMN IF NOT EXISTS cashbox_id TEXT REFERENCES cashboxes(id) ON DELETE RESTRICT`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_receipts_cashbox ON receipts(cashbox_id)`);
  // Link receipts to journals for document generation
  await p.query(`ALTER TABLE IF EXISTS receipts ADD COLUMN IF NOT EXISTS journal_id TEXT REFERENCES journals(id) ON DELETE SET NULL`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_receipts_journal ON receipts(journal_id)`);

  /* moved receipt_items table creation below checks to satisfy FK dependency */

  // Payments: normalized header/items similar to receipts
  await p.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      number TEXT,
      status TEXT DEFAULT 'draft' NOT NULL,
      date TIMESTAMPTZ NOT NULL,
      fiscal_year_id TEXT REFERENCES fiscal_years(id) ON DELETE SET NULL,
      detail_id TEXT REFERENCES details(id) ON DELETE SET NULL,
      description TEXT,
      total_amount NUMERIC(18,2) DEFAULT 0 NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);
  // Ensure default status is 'draft' for existing databases
  await p.query(`ALTER TABLE IF EXISTS payments ALTER COLUMN status SET DEFAULT 'draft'`);
  await p.query(`ALTER TABLE IF EXISTS payments ADD COLUMN IF NOT EXISTS special_code_id TEXT REFERENCES codes(id) ON DELETE SET NULL`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_payments_special_code ON payments(special_code_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_payments_fiscal_year ON payments(fiscal_year_id)`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_payments_fiscal_number ON payments(fiscal_year_id, number) WHERE number IS NOT NULL`);

  /* moved payment_items table creation below checks to satisfy FK dependency */
  /* moved payment_items indexes and constraint updates below to follow table creation */

  // Legacy simplified treasury receipts table kept for backwards compatibility
  await p.query(`
    CREATE TABLE IF NOT EXISTS treasury_receipts (
      id TEXT PRIMARY KEY,
      cashbox_id TEXT NOT NULL REFERENCES cashboxes(id) ON DELETE RESTRICT,
      fiscal_year_id TEXT REFERENCES fiscal_years(id) ON DELETE SET NULL,
      detail_id TEXT REFERENCES details(id) ON DELETE SET NULL,
      amount NUMERIC(18,2) NOT NULL,
      date TIMESTAMPTZ NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);
  await p.query(`ALTER TABLE IF EXISTS treasury_receipts ADD COLUMN IF NOT EXISTS detail_id TEXT REFERENCES details(id) ON DELETE SET NULL`);
  await p.query(`ALTER TABLE IF EXISTS treasury_receipts DROP COLUMN IF EXISTS party_id`);

  // Payments: money leaving cashbox or bank
  await p.query(`
    CREATE TABLE IF NOT EXISTS treasury_payments (
      id TEXT PRIMARY KEY,
      cashbox_id TEXT REFERENCES cashboxes(id) ON DELETE RESTRICT,
      bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL,
      fiscal_year_id TEXT REFERENCES fiscal_years(id) ON DELETE SET NULL,
      detail_id TEXT REFERENCES details(id) ON DELETE SET NULL,
      amount NUMERIC(18,2) NOT NULL,
      date TIMESTAMPTZ NOT NULL,
      method TEXT,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);
  await p.query(`ALTER TABLE IF EXISTS treasury_payments ADD COLUMN IF NOT EXISTS detail_id TEXT REFERENCES details(id) ON DELETE SET NULL`);
  await p.query(`ALTER TABLE IF EXISTS treasury_payments DROP COLUMN IF EXISTS party_id`);

  // Cash register entries: combined ledger of receipts and payments
  await p.query(`
    CREATE TABLE IF NOT EXISTS cash_register_entries (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL, -- 'receipt' or 'payment'
      source_id TEXT, -- id of treasury_receipts or treasury_payments
      cashbox_id TEXT REFERENCES cashboxes(id) ON DELETE RESTRICT,
      bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL,
      amount NUMERIC(18,2) NOT NULL,
      date TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  // Checks: lifecycle of incoming/outgoing cheques
  await p.query(`
    CREATE TABLE IF NOT EXISTS checks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('incoming','outgoing')),
      payment_id TEXT REFERENCES treasury_payments(id) ON DELETE SET NULL,
      number TEXT NOT NULL,
      bank_name TEXT,
      issuer TEXT,
      beneficiary TEXT,
      issue_date TIMESTAMPTZ NOT NULL,
      due_date TIMESTAMPTZ,
      amount NUMERIC(18,2) NOT NULL,
      currency TEXT DEFAULT 'IRR' NOT NULL,
      status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','incashbox','deposited','cleared','returned')),
      deposit_date TIMESTAMPTZ,
      deposit_bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL,
      clear_date TIMESTAMPTZ,
      return_date TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  // Checkbooks: one-to-many with bank accounts
  await p.query(`
    CREATE TABLE IF NOT EXISTS checkbooks (
      id TEXT PRIMARY KEY,
      bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
      series TEXT,
      start_number INT NOT NULL,
      page_count INT NOT NULL,
      issue_date TIMESTAMPTZ,
      received_date TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','exhausted','lost','damaged')),
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  // Card readers: one-to-many with bank accounts
  await p.query(`
    CREATE TABLE IF NOT EXISTS card_readers (
      id TEXT PRIMARY KEY,
      bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
      psp_provider TEXT NOT NULL,
      terminal_id TEXT NOT NULL,
      merchant_id TEXT,
      device_serial TEXT,
      brand TEXT,
      model TEXT,
      install_date TIMESTAMPTZ,
      last_settlement_date TIMESTAMPTZ,
      is_active BOOLEAN DEFAULT TRUE NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  // Ensure linking columns exist
  await p.query(`ALTER TABLE IF EXISTS treasury_payments ADD COLUMN IF NOT EXISTS card_reader_id TEXT REFERENCES card_readers(id) ON DELETE SET NULL`);
  await p.query(`ALTER TABLE IF EXISTS checks ADD COLUMN IF NOT EXISTS checkbook_id TEXT REFERENCES checkbooks(id) ON DELETE SET NULL`);
  await p.query(`ALTER TABLE IF EXISTS checks ADD COLUMN IF NOT EXISTS beneficiary_detail_id TEXT REFERENCES details(id) ON DELETE SET NULL`);
  // Add Sayadi code field to checks and checkbooks
  await p.query(`ALTER TABLE IF EXISTS checks ADD COLUMN IF NOT EXISTS sayadi_code TEXT`);
  await p.query(`ALTER TABLE IF EXISTS checkbooks ADD COLUMN IF NOT EXISTS sayadi_code TEXT`);

  // Instrument links: polymorphic link to card_reader, bank_account, or check
  await p.query(`
    CREATE TABLE IF NOT EXISTS instrument_links (
      id TEXT PRIMARY KEY,
      instrument_type TEXT NOT NULL CHECK (instrument_type IN ('card','transfer','check')),
      check_id TEXT REFERENCES checks(id) ON DELETE RESTRICT,
      card_reader_id TEXT REFERENCES card_readers(id) ON DELETE RESTRICT,
      bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      CONSTRAINT instrument_links_only_one CHECK (
        (instrument_type='check' AND check_id IS NOT NULL AND card_reader_id IS NULL AND bank_account_id IS NULL)
        OR (instrument_type='card' AND card_reader_id IS NOT NULL AND check_id IS NULL AND bank_account_id IS NULL)
        OR (instrument_type='transfer' AND bank_account_id IS NOT NULL AND check_id IS NULL AND card_reader_id IS NULL)
      )
    );
  `);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_instrument_links_check ON instrument_links(check_id) WHERE check_id IS NOT NULL`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_instrument_links_card ON instrument_links(card_reader_id) WHERE card_reader_id IS NOT NULL`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_instrument_links_bank ON instrument_links(bank_account_id) WHERE bank_account_id IS NOT NULL`);

  // Receipt items: moved here after checks and card_readers exist
  await p.query(`
    CREATE TABLE IF NOT EXISTS receipt_items (
      id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
      instrument_type TEXT NOT NULL CHECK (instrument_type IN ('cash','card','transfer','check')),
      amount NUMERIC(18,2) NOT NULL,
      reference TEXT,
      position INT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON receipt_items(receipt_id)`);
  await p.query(`ALTER TABLE IF EXISTS receipt_items ADD COLUMN IF NOT EXISTS card_reader_id TEXT REFERENCES card_readers(id) ON DELETE SET NULL`);

  // Add new polymorphic linkage column to receipt_items
  await p.query(`ALTER TABLE IF EXISTS receipt_items ADD COLUMN IF NOT EXISTS related_instrument_id TEXT REFERENCES instrument_links(id) ON DELETE SET NULL`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_receipt_items_related_instrument ON receipt_items(related_instrument_id)`);

  // Backfill related_instrument_id from legacy specific columns (card_reader_id, bank_account_id, check_id)
  try {
    const rows = await p.query(
      `SELECT id, instrument_type, bank_account_id, card_reader_id, check_id
       FROM receipt_items
       WHERE related_instrument_id IS NULL
         AND instrument_type IN ('card','transfer','check')`
    );
    for (const r of rows.rows || []) {
      const itemId = String(r.id);
      const inst = String(r.instrument_type || '').toLowerCase();
      let linkId: string | null = null;
      if (inst === 'check' && r.check_id) {
        const ex = await p.query(`SELECT id FROM instrument_links WHERE instrument_type='check' AND check_id=$1 LIMIT 1`, [String(r.check_id)]);
        if (ex.rowCount && ex.rows[0]?.id) {
          linkId = String(ex.rows[0].id);
        } else {
          linkId = randomUUID();
          await p.query(
            `INSERT INTO instrument_links (id, instrument_type, check_id) VALUES ($1,'check',$2)`,
            [linkId, String(r.check_id)]
          );
        }
      } else if (inst === 'card' && r.card_reader_id) {
        const ex = await p.query(`SELECT id FROM instrument_links WHERE instrument_type='card' AND card_reader_id=$1 LIMIT 1`, [String(r.card_reader_id)]);
        if (ex.rowCount && ex.rows[0]?.id) {
          linkId = String(ex.rows[0].id);
        } else {
          linkId = randomUUID();
          await p.query(
            `INSERT INTO instrument_links (id, instrument_type, card_reader_id) VALUES ($1,'card',$2)`,
            [linkId, String(r.card_reader_id)]
          );
        }
      } else if (inst === 'transfer' && r.bank_account_id) {
        const ex = await p.query(`SELECT id FROM instrument_links WHERE instrument_type='transfer' AND bank_account_id=$1 LIMIT 1`, [String(r.bank_account_id)]);
        if (ex.rowCount && ex.rows[0]?.id) {
          linkId = String(ex.rows[0].id);
        } else {
          linkId = randomUUID();
          await p.query(
            `INSERT INTO instrument_links (id, instrument_type, bank_account_id) VALUES ($1,'transfer',$2)`,
            [linkId, String(r.bank_account_id)]
          );
        }
      }
      if (linkId) {
        await p.query(`UPDATE receipt_items SET related_instrument_id=$1 WHERE id=$2`, [linkId, itemId]);
      }
    }
  } catch (e: any) {
    console.warn('Backfill related_instrument_id skipped or failed:', e?.message || e);
  }

  // Add unified reference column to receipt_items and backfill from legacy card_ref/transfer_ref
  await p.query(`ALTER TABLE IF EXISTS receipt_items ADD COLUMN IF NOT EXISTS reference TEXT`);
  try {
    await p.query(`
      UPDATE receipt_items
      SET reference = COALESCE(reference,
        CASE
          WHEN instrument_type = 'card' THEN card_ref
          WHEN instrument_type = 'transfer' THEN transfer_ref
          ELSE reference
        END
      )
      WHERE reference IS NULL
    `);
  } catch (e: any) {
    console.warn('Backfill receipt_items.reference skipped or failed:', e?.message || e);
  }
  await p.query('DROP INDEX IF EXISTS idx_receipt_items_card_ref');
  await p.query('DROP INDEX IF EXISTS idx_receipt_items_transfer_ref');
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_receipt_items_reference ON receipt_items(reference) WHERE reference IS NOT NULL`);
  await p.query('ALTER TABLE IF EXISTS receipt_items DROP COLUMN IF EXISTS card_ref');
  await p.query('ALTER TABLE IF EXISTS receipt_items DROP COLUMN IF EXISTS transfer_ref');

  // Drop legacy specific ID columns and related indexes
  await p.query(`ALTER TABLE IF EXISTS receipt_items DROP COLUMN IF EXISTS bank_account_id`);
  await p.query(`ALTER TABLE IF EXISTS receipt_items DROP COLUMN IF EXISTS card_reader_id`);
  await p.query(`ALTER TABLE IF EXISTS receipt_items DROP COLUMN IF EXISTS check_id`);
  await p.query(`DROP INDEX IF EXISTS idx_receipt_items_bank`);

  // Backfill receipts.cashbox_id from existing receipt_items prior to item column removal
  // This block is idempotent and will skip if legacy item-level columns are absent.
  {
    // Check existence of legacy columns before referencing them to avoid errors on re-runs
    const colCheck = await p.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'receipt_items'
         AND column_name IN ('cashbox_id','destination_type','destination_id')`
    );
    const hasCashbox = colCheck.rows?.some((r: any) => r.column_name === 'cashbox_id');
    const hasDestType = colCheck.rows?.some((r: any) => r.column_name === 'destination_type');
    const hasDestId = colCheck.rows?.some((r: any) => r.column_name === 'destination_id');

    if (hasCashbox || (hasDestType && hasDestId)) {
      // Build expression parts based on available columns
      const parts: string[] = [];
      if (hasCashbox) {
        parts.push(`MAX(CASE WHEN ri.instrument_type = 'cash' AND ri.cashbox_id IS NOT NULL THEN ri.cashbox_id END)`);
      }
      if (hasDestType && hasDestId) {
        parts.push(`MAX(CASE WHEN ri.instrument_type = 'check' AND ri.destination_type = 'cashbox' AND ri.destination_id IS NOT NULL THEN ri.destination_id END)`);
      }
      const expr = parts.length > 1 ? `COALESCE(${parts.join(',')})` : parts[0];

      await p.query(
        `UPDATE receipts r SET cashbox_id = COALESCE(r.cashbox_id, sub.cashbox_id)
         FROM (
           SELECT ri.receipt_id AS rid,
                  ${expr} AS cashbox_id
           FROM receipt_items ri
           GROUP BY ri.receipt_id
         ) AS sub
         WHERE r.id = sub.rid AND r.cashbox_id IS NULL`
      );
    }
  }
  // Remove item-level cashbox and destination columns now that cashbox lives on receipt
  await p.query(`ALTER TABLE IF EXISTS receipt_items DROP COLUMN IF EXISTS cashbox_id`);
  await p.query(`ALTER TABLE IF EXISTS receipt_items DROP COLUMN IF EXISTS destination_type`);
  await p.query(`ALTER TABLE IF EXISTS receipt_items DROP COLUMN IF EXISTS destination_id`);
  await p.query(`DROP INDEX IF EXISTS idx_receipt_items_cashbox`);

  // Ensure legacy columns are adjusted for existing DBs
  await p.query(`ALTER TABLE IF EXISTS checkbooks DROP COLUMN IF EXISTS end_number`);
  await p.query(`ALTER TABLE IF EXISTS checkbooks DROP COLUMN IF EXISTS next_number`);
  await p.query(`ALTER TABLE IF EXISTS checkbooks ADD COLUMN IF NOT EXISTS page_count INT NOT NULL DEFAULT 1`);
  // Remove deprecated receipt_id column and its index from checks
  await p.query(`DROP INDEX IF EXISTS idx_checks_receipt`);
  await p.query(`ALTER TABLE IF EXISTS checks DROP COLUMN IF EXISTS receipt_id`);

  // Payment items: moved here after checks exist
  await p.query(`
    CREATE TABLE IF NOT EXISTS payment_items (
      id TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      instrument_type TEXT NOT NULL CHECK (instrument_type IN ('cash','card','transfer','check','checkin')),
      amount NUMERIC(18,2) NOT NULL,
      cashbox_id TEXT REFERENCES cashboxes(id) ON DELETE SET NULL,
      bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL,
      reference TEXT,
      check_id TEXT REFERENCES checks(id) ON DELETE SET NULL,
      position INT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  // Add handler_detail_id to card_readers for linking to Details
  await p.query(`ALTER TABLE IF EXISTS card_readers ADD COLUMN IF NOT EXISTS handler_detail_id TEXT REFERENCES details(id) ON DELETE SET NULL`);

  // Payment items post-creation adjustments and indexing
  await p.query(`ALTER TABLE IF EXISTS payment_items DROP COLUMN IF EXISTS card_reader_id`);
  await p.query(`ALTER TABLE IF EXISTS payment_items DROP COLUMN IF EXISTS card_ref`);
  await p.query(`ALTER TABLE IF EXISTS payment_items DROP COLUMN IF EXISTS destination_type`);
  await p.query(`ALTER TABLE IF EXISTS payment_items DROP COLUMN IF EXISTS destination_id`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_payment_items_payment ON payment_items(payment_id)`);
  await p.query(`ALTER TABLE IF EXISTS payment_items DROP CONSTRAINT IF EXISTS payment_items_instrument_type_check`);
  await p.query(`ALTER TABLE IF EXISTS payment_items ADD CONSTRAINT payment_items_instrument_type_check CHECK (instrument_type IN ('cash','card','transfer','check','checkin'))`);

  // Add unified reference to payment_items and backfill from legacy transfer_ref
  await p.query(`ALTER TABLE IF EXISTS payment_items ADD COLUMN IF NOT EXISTS reference TEXT`);
  try {
    await p.query(`UPDATE payment_items SET reference = COALESCE(reference, transfer_ref) WHERE reference IS NULL`);
  } catch (e: any) {
    console.warn('Backfill payment_items.reference skipped or failed:', e?.message || e);
  }
  await p.query('ALTER TABLE IF EXISTS payment_items DROP COLUMN IF EXISTS transfer_ref');
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_items_reference ON payment_items(reference) WHERE reference IS NOT NULL`);

  // Useful indexes for reporting and lookups
  await p.query(`CREATE INDEX IF NOT EXISTS idx_treasury_receipts_cashbox ON treasury_receipts(cashbox_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_treasury_receipts_date ON treasury_receipts(date)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_treasury_payments_cashbox ON treasury_payments(cashbox_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_treasury_payments_bank ON treasury_payments(bank_account_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_treasury_payments_date ON treasury_payments(date)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_cash_register_entries_date ON cash_register_entries(date)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_cash_register_entries_cashbox ON cash_register_entries(cashbox_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_cash_register_entries_bank ON cash_register_entries(bank_account_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_checks_status ON checks(status)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_checks_due_date ON checks(due_date)`);
  // removed: idx_checks_receipt on receipt_id (deprecated)
  await p.query(`CREATE INDEX IF NOT EXISTS idx_checks_checkbook ON checks(checkbook_id)`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_outgoing_check_serial ON checks(checkbook_id, number) WHERE type = 'outgoing'`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_checks_payment ON checks(payment_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_checks_deposit_bank ON checks(deposit_bank_account_id)`);

  // Ensure checks.status allows 'issued'
  try {
    await p.query(`DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checks_status_check') THEN
        ALTER TABLE checks DROP CONSTRAINT checks_status_check;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_checks_status') THEN
        ALTER TABLE checks DROP CONSTRAINT chk_checks_status;
      END IF;
      EXCEPTION WHEN others THEN
        -- swallow to keep boot resilient
        NULL;
    END $$;`);
  } catch {}
  await p.query(`ALTER TABLE IF EXISTS checks ADD CONSTRAINT chk_checks_status CHECK (status IN ('created','issued','incashbox','deposited','cleared','returned'))`);

  await p.query(`CREATE INDEX IF NOT EXISTS idx_checkbooks_bank_account ON checkbooks(bank_account_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_card_readers_bank_account ON card_readers(bank_account_id)`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_card_readers_psp_terminal ON card_readers(psp_provider, terminal_id)`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS opening_entries (
      id TEXT PRIMARY KEY,
      fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
      journal_id TEXT NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS closing_entries (
      id TEXT PRIMARY KEY,
      fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
      journal_id TEXT NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      details JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  schemaReady = true;
}

/**
 * Upsert a user by mobile number.
 * Returns the user's id (new or existing).
 */
export async function upsertUserByMobile(mobileNumber: string): Promise<{ id: string }>{
  const p = getPool();
  const id = randomUUID();
  const res = await p.query(
    `INSERT INTO users (id, mobile_number) VALUES ($1, $2)
     ON CONFLICT (mobile_number) DO UPDATE SET mobile_number = EXCLUDED.mobile_number
     RETURNING id`,
    [id, mobileNumber]
  );
  return { id: res.rows[0].id };
}

/** Store a refresh token row with expiry. */
export async function storeRefreshToken(token: string, userId: string, expiresAtMs: number): Promise<void> {
  const p = getPool();
  await p.query(
    `INSERT INTO refresh_tokens (token, user_id, revoked, expires_at)
     VALUES ($1, $2, FALSE, to_timestamp($3/1000.0))
     ON CONFLICT (token) DO NOTHING`,
    [token, userId, expiresAtMs]
  );
}

/** Mark a refresh token revoked. */
export async function revokeRefreshToken(token: string): Promise<void> {
  const p = getPool();
  await p.query(`UPDATE refresh_tokens SET revoked = TRUE WHERE token = $1`, [token]);
}

/** Find a refresh token joined to user mobile number. */
export async function findRefreshToken(token: string): Promise<{ token: string; revoked: boolean; expires_at: Date; mobile_number: string } | null> {
  const p = getPool();
  const res = await p.query(
    `SELECT rt.token, rt.revoked, rt.expires_at, u.mobile_number
     FROM refresh_tokens rt JOIN users u ON rt.user_id = u.id
     WHERE rt.token = $1`,
    [token]
  );
  if (res.rowCount === 0) return null;
  return res.rows[0];
}

/** Ping Postgres connectivity for health checks. */
export async function ping(): Promise<{ ok: boolean; driver: 'postgres'; info?: any }>{
  const p = getPool();
  const res = await p.query('SELECT 1 AS ok');
  return { ok: res.rows[0].ok === 1, driver: 'postgres' };
}