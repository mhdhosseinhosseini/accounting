/* Verify created tables in Postgres. */
const { Pool } = require('pg');
const conn = process.env.POSTGRES_URL || process.env.DATABASE_URL || 'postgres://root:MtXzhMmpMAayA1QfuD3rxUvn@lhotse.liara.cloud:33564/postgres';
const pool = new Pool({ connectionString: conn });
(async () => {
  const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
  console.log(res.rows.map(r => r.table_name).join('\n'));
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });