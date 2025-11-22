/**
 * normalizeYeh.ts
 * 
 * Purpose: Scan all user tables for text-like columns and replace Arabic yeh 'ي' with Persian yeh 'ی'.
 * - Targets columns of types: TEXT, VARCHAR, CHAR (optionally handles CITEXT if present).
 * - Skips JSON/JSONB and numeric/date columns to avoid type issues.
 * - Runs per-column updates with safeguards (NULL-safe, WHERE LIKE '%ي%').
 * - Logs bilingual progress (English and Persian) and a final summary report.
 * 
 * Usage:
 *   npx ts-node src/scripts/normalizeYeh.ts
 *   (Relies on DATABASE_URL/POSTGRES_URL in .env)
 */
import dotenv from 'dotenv';
dotenv.config();
import { getPool } from '../db/pg';

/**
 * Quote an identifier (schema/table/column) safely for Postgres dynamic SQL.
 */
function qid(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

/**
 * Determine whether a column is text-like and eligible for normalization.
 */
function isTextType(dataType: string, udtName: string): boolean {
  const t = dataType.toLowerCase();
  const u = udtName.toLowerCase();
  return (
    t === 'text' ||
    t === 'character varying' ||
    t === 'character' ||
    u === 'citext'
  );
}

/**
 * Normalize Arabic yeh to Persian yeh across all text columns in public schema.
 * Returns a map of affected rows per table.column.
 */
async function normalizeArabicYeh(): Promise<{ [key: string]: number }>{
  const pool = getPool();
  const results: { [key: string]: number } = {};

  console.log('[Normalize] Starting Arabic yeh → Persian yeh replacement');
  console.log('[نرمال‌سازی] شروع جایگزینی "ي" → "ی" در ستون‌های متنی');

  // Fetch candidate columns in public schema
  const colsRes = await pool.query(
    `SELECT table_schema, table_name, column_name, data_type, udt_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND data_type IN ('text', 'character varying', 'character')
       OR udt_name = 'citext'
     ORDER BY table_name, ordinal_position`
  );

  for (const row of colsRes.rows) {
    const schema = row.table_schema as string;
    const table = row.table_name as string;
    const column = row.column_name as string;
    const dataType = row.data_type as string;
    const udtName = row.udt_name as string;

    if (!isTextType(dataType, udtName)) continue;

    const tableId = `${schema}.${table}.${column}`;

    // Count rows needing change
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM ${qid(schema)}.${qid(table)} WHERE ${qid(column)} IS NOT NULL AND ${qid(column)} LIKE '%ي%'`
    );
    const cnt = countRes.rows[0]?.cnt ?? 0;
    if (cnt === 0) continue;

    // Perform update; cast for citext to preserve type if needed
    const needsCast = udtName.toLowerCase() === 'citext';
    const setExpr = needsCast
      ? `REPLACE(${qid(column)}::text, 'ي', 'ی')::citext`
      : `REPLACE(${qid(column)}, 'ي', 'ی')`;

    try {
      const updateRes = await pool.query(
        `UPDATE ${qid(schema)}.${qid(table)}
         SET ${qid(column)} = ${setExpr}
         WHERE ${qid(column)} IS NOT NULL AND ${qid(column)} LIKE '%ي%'`
      );
      const updated = updateRes.rowCount || 0;
      results[tableId] = (results[tableId] || 0) + updated;
      console.log(`[Normalize] ${tableId}: updated ${updated} rows`);
      console.log(`[نرمال‌سازی] ${tableId}: ${updated} ردیف به‌روزرسانی شد`);
    } catch (err: any) {
      // Continue on errors (e.g., unique conflicts); report and proceed
      console.error(`[Normalize][ERROR] ${tableId}:`, err?.message || err);
      console.error(`[نرمال‌سازی][خطا] ${tableId}:`, err?.message || err);
    }
  }

  return results;
}

/**
 * Entry point: run normalization and print a summary.
 */
async function main() {
  const t0 = Date.now();
  const results = await normalizeArabicYeh();
  const total = Object.values(results).reduce((a, b) => a + b, 0);
  const secs = ((Date.now() - t0) / 1000).toFixed(2);

  console.log('---------------------------------------------');
  console.log(`[Normalize] Completed: ${total} total rows updated in ${secs}s`);
  console.log('[نرمال‌سازی] تکمیل شد:', `${total} ردیف در مجموع طی ${secs} ثانیه به‌روزرسانی شد`);
  const entries = Object.entries(results).sort((a, b) => b[1] - a[1]);
  for (const [key, val] of entries) {
    console.log(` - ${key}: ${val}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[Normalize][FATAL]', err?.message || err);
  console.error('[نرمال‌سازی][خطا]', err?.message || err);
  process.exit(1);
});