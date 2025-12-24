import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getPool } from '../db/pg';

/**
 * Apply only the drop-legacy tables migration for the accounting schema.
 * - Reads 0020_remove_legacy_tables.sql and executes it against the active DB.
 * - Ensures `schema_migrations` exists and records the version if not already applied.
 * - Bilingual logs (English/Farsi) for visibility.
 */
async function run(): Promise<void> {
  const version = '0020_remove_legacy_tables';
  const baseDir = path.resolve(__dirname, '../../migrations/postgres');
  const filePath = path.join(baseDir, `${version}.sql`);

  if (!fs.existsSync(filePath)) {
    console.error(`Migration file not found: ${filePath}`);
    console.error('فایل مهاجرت پیدا نشد.');
    process.exit(1);
  }

  const p = getPool();
  await ensureMigrationsTable(p);

  const already = await isApplied(p, version);
  if (already) {
    console.log(`Skip ${version} (already applied).`);
    console.log(`رد شد ${version} (قبلاً اعمال شده).`);
    return;
  }

  const sql = fs.readFileSync(filePath, 'utf-8');
  console.log(`Applying ${version} (accounting schema)...`);
  console.log(`در حال اعمال ${version} (اسکیمای حسابداری)...`);

  try {
    await p.query(sql);
    await p.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    console.log('Applied successfully.');
    console.log('با موفقیت اعمال شد.');
  } catch (err: any) {
    console.error(`Failed to apply ${version}:`, err);
    console.error(`اعمال ${version} ناموفق بود:`, err?.message || err);
    process.exit(1);
  }
}

/**
 * Ensure the tracking table exists.
 * Creates `schema_migrations` if missing.
 */
async function ensureMigrationsTable(p: ReturnType<typeof getPool>): Promise<void> {
  await p.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * Check if a migration version has been applied.
 * Returns true if present in `schema_migrations`.
 */
async function isApplied(p: ReturnType<typeof getPool>, version: string): Promise<boolean> {
  const res = await p.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
  return (res.rowCount ?? 0) > 0;
}

run().catch((err) => {
  console.error('Migration failed:', err);
  console.error('اعمال مهاجرت ناموفق بود:', err?.message || err);
  process.exit(1);
});