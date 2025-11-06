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
    pool = new Pool({ connectionString });
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

  await p.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      parent_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      level INT DEFAULT 0 NOT NULL,
      type TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

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
      code TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS journals (
      id TEXT PRIMARY KEY,
      fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
      ref_no TEXT,
      date TIMESTAMPTZ NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'draft' NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS journal_items (
      id TEXT PRIMARY KEY,
      journal_id TEXT NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
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