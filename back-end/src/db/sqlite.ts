import Database from 'better-sqlite3';

import { randomUUID } from 'crypto';

let db: Database.Database | null = null;
let schemaReady = false;

/**
 * Get or initialize a singleton SQLite database connection.
 * Returns the active database.
 */
export function getDb(): Database.Database {
  if (!db) {
    const file = process.env.SQLITE_FILE || process.env.SQLITE_PATH || ':memory:';
    db = new Database(file);
  }
  return db;
}

/**
 * Ensure database schema for Phase 1+2 on SQLite.
 * - Creates authentication tables and core accounting tables if missing.
 * - Safe to call multiple times; uses IF NOT EXISTS.
 */
export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  const d = getDb();

  // Wrap schema creation in a transaction for consistency
  const txn = d.transaction(() => {
    // Phase 1 tables (existing)
    d.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        mobile_number TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    d.exec(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        revoked INTEGER DEFAULT 0 NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    // Phase 2 core tables
    d.exec(`
      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    d.exec(`
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        UNIQUE(user_id, role_id),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE
      );
    `);

    d.exec(`
      CREATE TABLE IF NOT EXISTS fiscal_years (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        is_closed INTEGER DEFAULT 0 NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    // Accounts table removed; journal_items now references codes instead of accounts.

    // Details: global 4-digit codes, no prefix, unique
    d.exec(`
      CREATE TABLE IF NOT EXISTS details (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        is_active INTEGER DEFAULT 1 NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    // Codes: two-level General → Specific tree with optional parent
    d.exec(`
      CREATE TABLE IF NOT EXISTS codes (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        parent_id TEXT,
        is_active INTEGER DEFAULT 1 NOT NULL,
        nature INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY(parent_id) REFERENCES codes(id) ON DELETE SET NULL
      );
    `);

    // Ensure legacy SQLite databases also have the 'nature' column
    const cols = d.prepare("PRAGMA table_info(codes)").all() as any[];
    const hasNature = Array.isArray(cols) && cols.some((c: any) => c.name === 'nature');
    if (!hasNature) {
      d.exec(`ALTER TABLE codes ADD COLUMN nature INTEGER`);
    }

    d.exec(`
      CREATE TABLE IF NOT EXISTS parties (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT UNIQUE,
        mobile TEXT,
        address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    d.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sku TEXT UNIQUE,
        price REAL DEFAULT 0 NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    d.exec(`
      CREATE TABLE IF NOT EXISTS warehouses (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    d.exec(`
      CREATE TABLE IF NOT EXISTS journals (
        id TEXT PRIMARY KEY,
        fiscal_year_id TEXT NOT NULL,
        ref_no TEXT,
        date DATETIME NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'draft' NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years(id) ON DELETE CASCADE
      );
    `);

    d.exec(`
      CREATE TABLE IF NOT EXISTS journal_items (
        id TEXT PRIMARY KEY,
        journal_id TEXT NOT NULL,
        code_id TEXT NOT NULL,
        party_id TEXT,
        debit REAL DEFAULT 0 NOT NULL,
        credit REAL DEFAULT 0 NOT NULL,
        description TEXT,
        FOREIGN KEY(journal_id) REFERENCES journals(id) ON DELETE CASCADE,
        FOREIGN KEY(code_id) REFERENCES codes(id) ON DELETE RESTRICT,
        FOREIGN KEY(party_id) REFERENCES parties(id) ON DELETE SET NULL
      );
    `);

    d.exec(`
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        invoice_no TEXT UNIQUE,
        fiscal_year_id TEXT,
        customer_id TEXT,
        date DATETIME NOT NULL,
        status TEXT DEFAULT 'draft' NOT NULL,
        total REAL DEFAULT 0 NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years(id) ON DELETE SET NULL,
        FOREIGN KEY(customer_id) REFERENCES parties(id) ON DELETE SET NULL
      );
    `);

    d.exec(`
      CREATE TABLE IF NOT EXISTS invoice_items (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,
        product_id TEXT,
        quantity REAL DEFAULT 0 NOT NULL,
        unit_price REAL DEFAULT 0 NOT NULL,
        total REAL DEFAULT 0 NOT NULL,
        FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
        FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL
      );
    `);

    d.exec(`
      CREATE TABLE IF NOT EXISTS inventory_transactions (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        warehouse_id TEXT NOT NULL,
        quantity REAL NOT NULL,
        type TEXT NOT NULL,
        date DATETIME NOT NULL,
        reference TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE RESTRICT,
        FOREIGN KEY(warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT
      );
    `);

    d.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        party_id TEXT,
        amount REAL NOT NULL,
        date DATETIME NOT NULL,
        method TEXT,
        reference TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY(party_id) REFERENCES parties(id) ON DELETE SET NULL
      );
    `);

    d.exec(`
      CREATE TABLE IF NOT EXISTS opening_entries (
        id TEXT PRIMARY KEY,
        fiscal_year_id TEXT NOT NULL,
        journal_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years(id) ON DELETE CASCADE,
        FOREIGN KEY(journal_id) REFERENCES journals(id) ON DELETE CASCADE
      );
    `);

    d.exec(`
      CREATE TABLE IF NOT EXISTS closing_entries (
        id TEXT PRIMARY KEY,
        fiscal_year_id TEXT NOT NULL,
        journal_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years(id) ON DELETE CASCADE,
        FOREIGN KEY(journal_id) REFERENCES journals(id) ON DELETE CASCADE
      );
    `);

    d.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        actor_user_id TEXT,
        action TEXT NOT NULL,
        entity TEXT,
        entity_id TEXT,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);
  });

  txn();
  schemaReady = true;
}

/**
 * Upsert a user by mobile number and return id.
 */
export async function upsertUserByMobile(mobileNumber: string): Promise<{ id: string }>{
  const d = getDb();
  const id = randomUUID();
  const insert = d.prepare(`INSERT INTO users (id, mobile_number) VALUES (?, ?)`);
  try {
    insert.run(id, mobileNumber);
    return { id };
  } catch {
    const row = d.prepare(`SELECT id FROM users WHERE mobile_number = ?`).get(mobileNumber) as { id: string } | undefined;
    if (!row) throw new Error('Failed to upsert user');
    return { id: row.id };
  }
}

/** Persist a refresh token row with expiry. */
export async function storeRefreshToken(token: string, userId: string, expiresAtMs: number): Promise<void> {
  const d = getDb();
  const stmt = d.prepare(`INSERT OR IGNORE INTO refresh_tokens (token, user_id, revoked, expires_at) VALUES (?, ?, 0, datetime(?/1000, 'unixepoch'))`);
  stmt.run(token, userId, expiresAtMs);
}

/** Mark a refresh token revoked. */
export async function revokeRefreshToken(token: string): Promise<void> {
  const d = getDb();
  d.prepare(`UPDATE refresh_tokens SET revoked = 1 WHERE token = ?`).run(token);
}

/** Find a refresh token joined to user mobile number. */
export async function findRefreshToken(token: string): Promise<{ token: string; revoked: boolean; expires_at: Date; mobile_number: string } | null> {
  const d = getDb();
  const row = d.prepare(`
    SELECT rt.token, rt.revoked, rt.expires_at, u.mobile_number
    FROM refresh_tokens rt JOIN users u ON rt.user_id = u.id
    WHERE rt.token = ?
  `).get(token) as any;
  if (!row) return null;
  return {
    token: row.token,
    revoked: !!row.revoked,
    expires_at: new Date(row.expires_at),
    mobile_number: row.mobile_number,
  };
}

/** Ping SQLite connectivity for health checks. */
export async function ping(): Promise<{ ok: boolean; driver: 'sqlite'; info?: any }>{
  const d = getDb();
  const row = d.prepare('SELECT 1 AS ok').get() as { ok: number };
  return { ok: row.ok === 1, driver: 'sqlite' };
}