/* Verify created tables in Postgres. */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const conn = process.env.POSTGRES_URL || process.env.DATABASE_URL || 'postgres://root:MtXzhMmpMAayA1QfuD3rxUvn@lhotse.liara.cloud:33564/postgres';
const pool = new Pool({ connectionString: conn });
(async () => {
  const schema = process.env.ACCOUNTING_SCHEMA || 'accounting';
  const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name", [schema]);
  console.log(res.rows.map(r => r.table_name).join('\n'));
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });