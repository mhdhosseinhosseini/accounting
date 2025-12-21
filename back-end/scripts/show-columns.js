/* Print columns of payments and payment_items tables for quick verification. */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const conn = process.env.POSTGRES_URL || process.env.DATABASE_URL || 'postgres://root:MtXzhMmpMAayA1QfuD3rxUvn@lhotse.liara.cloud:33564/postgres';
const pool = new Pool({ connectionString: conn });
(async () => {
  const schema = process.env.ACCOUNTING_SCHEMA || 'accounting';
  const printCols = async (table) => {
    const res = await pool.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position",
      [schema, table]
    );
    console.log(`\nTable: ${schema}.${table} (${res.rowCount} columns)`);
    if (!res.rowCount) {
      console.log('  [no columns found]');
      return;
    }
    res.rows.forEach(r => console.log(`${r.column_name} : ${r.data_type}`));
  };
  await printCols('payments');
  await printCols('payment_items');
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });