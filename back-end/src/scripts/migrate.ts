import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getPool } from '../db/pg';
import { getDb } from '../db/sqlite';

/**
 * Run database migrations for the selected driver (Postgres or SQLite).
 * - Reads SQL files from migrations/{postgres|sqlite} ordered by filename.
 * - Creates a `schema_migrations` table to track applied versions.
 * - Applies missing migrations idempotently.
 * - Logs messages in English and Farsi for bilingual visibility.
 */
async function run(): Promise<void> {
  const driver = (process.env.DB_DRIVER || 'postgres').toLowerCase();
  if (driver !== 'sqlite' && driver !== 'postgres') {
    console.error('Unknown DB_DRIVER, expected "sqlite" or "postgres".');
    console.error('مقدار DB_DRIVER نامعتبر است؛ باید sqlite یا postgres باشد.');
    process.exit(1);
  }

  const baseDir = path.resolve(__dirname, '../../migrations', driver === 'sqlite' ? 'sqlite' : 'postgres');
  if (!fs.existsSync(baseDir)) {
    console.error(`Migrations directory not found: ${baseDir}`);
    console.error('پوشه مهاجرت پایگاه‌داده پیدا نشد.');
    process.exit(1);
  }

  const files = fs
    .readdirSync(baseDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    console.log('No migration files to apply.');
    console.log('فایلی برای مهاجرت وجود ندارد.');
    return;
  }

  if (driver === 'sqlite') {
    await migrateSqlite(baseDir, files);
  } else {
    await migratePostgres(baseDir, files);
  }

  console.log('Migrations applied successfully.');
  console.log('مهاجرت‌ها با موفقیت اعمال شدند.');
}

/**
 * Ensure the schema_migrations table exists in Postgres.
 */
async function ensureMigrationsTablePostgres(): Promise<void> {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * Ensure the schema_migrations table exists in SQLite.
 */
function ensureMigrationsTableSqlite(): void {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * Get the set of applied migration versions in Postgres.
 */
async function getAppliedPostgres(): Promise<Set<string>> {
  const p = getPool();
  const res = await p.query('SELECT version FROM schema_migrations');
  return new Set(res.rows.map((r: any) => r.version));
}

/**
 * Get the set of applied migration versions in SQLite.
 */
function getAppliedSqlite(): Set<string> {
  const d = getDb();
  const rows = d.prepare('SELECT version FROM schema_migrations').all();
  return new Set(rows.map((r: any) => r.version));
}

/**
 * Apply migrations for Postgres.
 */
async function migratePostgres(baseDir: string, files: string[]): Promise<void> {
  await ensureMigrationsTablePostgres();
  const applied = await getAppliedPostgres();
  const p = getPool();

  for (const file of files) {
    const version = path.basename(file, '.sql');
    if (applied.has(version)) {
      console.log(`Skip ${version} (already applied).`);
      console.log(`رد شد ${version} (قبلاً اعمال شده).`);
      continue;
    }
    const sql = fs.readFileSync(path.join(baseDir, file), 'utf-8');
    console.log(`Applying ${version}...`);
    console.log(`در حال اعمال ${version}...`);
    try {
      await p.query(sql);
      await p.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    } catch (err: any) {
      console.error(`Failed to apply ${version}:`, err);
      console.error(`اعمال ${version} ناموفق بود:`, err?.message || err);
      throw err;
    }
  }
}

/**
 * Apply migrations for SQLite.
 */
async function migrateSqlite(baseDir: string, files: string[]): Promise<void> {
  ensureMigrationsTableSqlite();
  const applied = getAppliedSqlite();
  const d = getDb();

  for (const file of files) {
    const version = path.basename(file, '.sql');
    if (applied.has(version)) {
      console.log(`Skip ${version} (already applied).`);
      console.log(`رد شد ${version} (قبلاً اعمال شده).`);
      continue;
    }
    const sql = fs.readFileSync(path.join(baseDir, file), 'utf-8');
    console.log(`Applying ${version}...`);
    console.log(`در حال اعمال ${version}...`);
    try {
      d.exec(sql);
      d.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
    } catch (err: any) {
      console.error('SQLite migration failed:', err);
      console.error('اعمال مهاجرت در اس‌کیو‌الایت ناموفق بود:', err?.message || err);
      throw err;
    }
  }
}

// Execute
run().catch((err) => {
  console.error('Migration failed:', err);
  console.error('اعمال مهاجرت ناموفق بود:', err?.message || err);
  process.exit(1);
});