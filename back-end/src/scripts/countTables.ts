import { Pool } from 'pg';

/**
 * countTables.ts
 * English: Print exact row counts for every table in a given schema.
 * فارسی: شمارش دقیقِ رکوردها برای همهٔ جداول یک طرح‌واره.
 *
 * Usage:
 *   ts-node src/scripts/countTables.ts --url=postgres://... --schema=accounting
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const out: { url?: string; schema?: string } = {};
  for (const a of args) {
    if (a.startsWith('--url=')) out.url = a.substring('--url='.length);
    else if (a.startsWith('--schema=')) out.schema = a.substring('--schema='.length);
  }
  return out;
}

/**
 * English: Get list of tables under a schema.
 * فارسی: دریافت فهرست جداولِ یک طرح‌واره.
 */
async function listTables(pool: Pool, schema: string): Promise<string[]> {
  const q = `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type='BASE TABLE' ORDER BY table_name`;
  const r = await pool.query(q, [schema]);
  return r.rows.map((row: any) => row.table_name);
}

/**
 * English: Count rows in a table using COUNT(*).
 * فارسی: شمارش رکوردهای یک جدول با COUNT(*).
 */
async function countTable(pool: Pool, schema: string, table: string): Promise<number> {
  const q = `SELECT COUNT(*) AS c FROM ${schema}."${table}"`;
  const r = await pool.query(q);
  return Number(r.rows[0].c);
}

async function main() {
  const { url, schema } = parseArgs();
  if (!url || !schema) {
    console.error('Usage: ts-node src/scripts/countTables.ts --url=URL --schema=accounting');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  try {
    console.log(`Schema: ${schema}`);
    const tables = await listTables(pool, schema);
    for (const t of tables) {
      const n = await countTable(pool, schema, t);
      console.log(`${t}: ${n}`);
    }
  } finally {
    await pool.end();
  }
}

main();