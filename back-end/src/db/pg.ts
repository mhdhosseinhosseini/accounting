import { Pool } from 'pg';
import { randomUUID } from 'crypto';

let pool: Pool | null = null;
let schemaReady = false;

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
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS detail_levels (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      parent_id TEXT REFERENCES detail_levels(id) ON DELETE SET NULL,
      specific_code_id TEXT,
      is_active BOOLEAN DEFAULT TRUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      CONSTRAINT detail_levels_root_specific CHECK (
        (parent_id IS NULL AND specific_code_id IS NOT NULL)
        OR (parent_id IS NOT NULL AND specific_code_id IS NULL)
      )
    );
  `);

  // Harden legacy table to include required columns
  await p.query(`ALTER TABLE IF EXISTS detail_levels ADD COLUMN IF NOT EXISTS code TEXT`);
  await p.query(`ALTER TABLE IF EXISTS detail_levels ADD COLUMN IF NOT EXISTS title TEXT`);
  await p.query(`ALTER TABLE IF EXISTS detail_levels ADD COLUMN IF NOT EXISTS specific_code_id TEXT`);
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
      -- Rename legacy linked_code_id or code_id to specific_code_id
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='detail_levels' AND column_name='linked_code_id'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='detail_levels' AND column_name='specific_code_id'
      ) THEN
        EXECUTE 'ALTER TABLE detail_levels RENAME COLUMN linked_code_id TO specific_code_id';
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='detail_levels' AND column_name='code_id'
      ) THEN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='detail_levels' AND column_name='specific_code_id'
        ) THEN
          EXECUTE 'ALTER TABLE detail_levels RENAME COLUMN code_id TO specific_code_id';
        ELSE
          -- Migrate data then drop legacy column
          EXECUTE 'UPDATE detail_levels SET specific_code_id = COALESCE(specific_code_id, code_id) WHERE code_id IS NOT NULL';
          EXECUTE 'ALTER TABLE detail_levels DROP COLUMN code_id';
        END IF;
      END IF;
      -- Ensure specific_code_id is nullable on legacy DBs
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='detail_levels' AND column_name='specific_code_id'
      ) THEN
        EXECUTE 'ALTER TABLE detail_levels ALTER COLUMN specific_code_id DROP NOT NULL';
      END IF;

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

  await p.query(`
    CREATE TABLE IF NOT EXISTS journals (
      id TEXT PRIMARY KEY,
      fiscal_year_id TEXT REFERENCES fiscal_years(id) ON DELETE SET NULL,
      date TIMESTAMPTZ NOT NULL,
      ref_no TEXT,
      status TEXT DEFAULT 'draft' NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS journal_items (
      id TEXT PRIMARY KEY,
      journal_id TEXT NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
      code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE RESTRICT,
      party_id TEXT REFERENCES parties(id) ON DELETE SET NULL,
      debit NUMERIC(18,2) DEFAULT 0 NOT NULL,
      credit NUMERIC(18,2) DEFAULT 0 NOT NULL,
      description TEXT
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      invoice_no TEXT UNIQUE,
      fiscal_year_id TEXT REFERENCES fiscal_years(id) ON DELETE SET NULL,
      customer_id TEXT REFERENCES parties(id) ON DELETE SET NULL,
      date TIMESTAMPTZ NOT NULL,
      status TEXT DEFAULT 'draft' NOT NULL,
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

  await p.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      party_id TEXT REFERENCES parties(id) ON DELETE SET NULL,
      amount NUMERIC(18,2) NOT NULL,
      date TIMESTAMPTZ NOT NULL,
      method TEXT,
      reference TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

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