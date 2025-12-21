/**
 * Check existence of the accounting schema inside the Greenbunch database.
 * English: Verifies that `ACCOUNTING_SCHEMA` exists in `information_schema.schemata`.
 * فارسی: بررسی می‌کند که طرح‌واره «ACCOUNTING_SCHEMA» در پایگاه‌داده وجود دارد.
 */
const dotenv = require('dotenv');
// Load default env and local overrides
dotenv.config();
dotenv.config({ path: '.env.local' });

/**
 * Run a single query against Postgres to check schema existence.
 * English: Prints a concise result and exits.
 * فارسی: نتیجه را به‌صورت خلاصه چاپ کرده و خارج می‌شود.
 */
async function checkSchema() {
  const { Pool } = require('pg');
  const schema = process.env.ACCOUNTING_SCHEMA || 'accounting';
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('Error: DATABASE_URL is not set. / خطا: مقدار DATABASE_URL تنظیم نشده است.');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  try {
    const q = 'SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1';
    const r = await pool.query(q, [schema]);
    const exists = r.rowCount > 0;
    console.log(`Accounting schema exists: ${exists} | schema: ${schema}`);
    console.log(`طرح‌واره حسابداری وجود دارد: ${exists} | طرح‌واره: ${schema}`);
    process.exit(exists ? 0 : 2);
  } catch (e) {
    console.error('Query error:', e.message);
    console.error('خطای کوئری:', e.message);
    process.exit(1);
  } finally {
    pool.end().catch(() => {});
  }
}

// Execute
checkSchema();