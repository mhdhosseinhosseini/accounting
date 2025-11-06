import 'dotenv/config';
import { randomUUID } from 'crypto';
import { ensureSchema } from '../db/driver';
import { getPool } from '../db/pg';
import { getDb } from '../db/sqlite';

/**
 * Seed Phase 2 minimal data across the selected DB driver.
 * - Creates base roles, current fiscal year, and root account categories.
 * - Idempotent: uses upsert semantics to avoid duplicates.
 * - Note: Fiscal year uses Gregorian year boundaries (Jan 1–Dec 31) by default.
 */
async function main(): Promise<void> {
  await ensureSchema();
  const driver = (process.env.DB_DRIVER || 'postgres').toLowerCase();
  if (driver === 'sqlite') {
    await seedSqlite();
  } else {
    await seedPostgres();
  }
  // Bilingual confirmation logs
  console.log('Seed completed successfully.');
  console.log('مقداردهی اولیه با موفقیت انجام شد.');
}

/**
 * Seed data for Postgres driver.
 */
async function seedPostgres(): Promise<void> {
  const p = getPool();
  // Roles
  const roles = ['admin', 'user'];
  for (const name of roles) {
    await p.query(
      `INSERT INTO roles (id, name) VALUES ($1, $2)
       ON CONFLICT (name) DO NOTHING`,
      [randomUUID(), name]
    );
  }

  // Fiscal Year
  const now = new Date();
  const year = now.getFullYear();
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  await p.query(
    `INSERT INTO fiscal_years (id, name, start_date, end_date, is_closed)
     VALUES ($1, $2, $3, $4, FALSE)
     ON CONFLICT (id) DO NOTHING`,
    [randomUUID(), `FY-${year}`, start, end]
  );

  // Base Accounts
  const accounts = [
    { code: '1000', name: 'Assets', type: 'asset' },
    { code: '2000', name: 'Liabilities', type: 'liability' },
    { code: '3000', name: 'Equity', type: 'equity' },
    { code: '4000', name: 'Revenue', type: 'revenue' },
    { code: '5000', name: 'Expenses', type: 'expense' },
  ];
  for (const a of accounts) {
    await p.query(
      `INSERT INTO accounts (id, code, name, level, type)
       VALUES ($1, $2, $3, 0, $4)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
      [randomUUID(), a.code, a.name, a.type]
    );
  }

  console.log('Seeded roles, fiscal_year, and base accounts (Postgres).');
  console.log('نقش‌ها، سال مالی و حساب‌های پایه در پستگرس مقداردهی شدند.');
}

/**
 * Seed data for SQLite driver.
 */
async function seedSqlite(): Promise<void> {
  const d = getDb();
  const txn = d.transaction(() => {
    // Roles
    const roleStmt = d.prepare(`INSERT OR IGNORE INTO roles (id, name) VALUES (?, ?)`);
    for (const name of ['admin', 'user']) {
      roleStmt.run(randomUUID(), name);
    }

    // Fiscal Year
    const now = new Date();
    const year = now.getFullYear();
    const fiscalId = randomUUID();
    d.prepare(`INSERT OR IGNORE INTO fiscal_years (id, name, start_date, end_date, is_closed) VALUES (?, ?, ?, ?, 0)`) 
      .run(fiscalId, `FY-${year}`, `${year}-01-01`, `${year}-12-31`);

    // Base Accounts
    const accStmt = d.prepare(`INSERT OR REPLACE INTO accounts (id, code, name, level, type) VALUES (?, ?, ?, 0, ?)`);
    const accounts = [
      { code: '1000', name: 'Assets', type: 'asset' },
      { code: '2000', name: 'Liabilities', type: 'liability' },
      { code: '3000', name: 'Equity', type: 'equity' },
      { code: '4000', name: 'Revenue', type: 'revenue' },
      { code: '5000', name: 'Expenses', type: 'expense' },
    ];
    for (const a of accounts) {
      accStmt.run(randomUUID(), a.code, a.name, a.type);
    }
  });

  txn();
  console.log('Seeded roles, fiscal_year, and base accounts (SQLite).');
  console.log('نقش‌ها، سال مالی و حساب‌های پایه در اس‌کیو‌الایت مقداردهی شدند.');
}

// Execute seeds
main().catch((err) => {
  console.error('Seed failed:', err);
  console.error('خطا در مقداردهی اولیه:', err?.message || err);
  process.exit(1);
});