"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const pg_1 = require("pg");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * copySchema.ts
 * English: Copy DATA from a specific schema in one Postgres database to the same schema in another database.
 * - Uses pg_dump with --data-only and --schema=<name> to export rows.
 * - Optionally truncates target schema tables before import to avoid unique conflicts.
 * - Creates any missing tables in the destination schema when detected.
 * - Temporarily disables triggers during data import to handle circular FKs.
 * فارسی: کپیِ داده‌های یک طرح‌واره از یک پایگاه‌داده پستگرس به همان طرح‌واره در پایگاه‌داده دیگر.
 * - با pg_dump و گزینه‌های --data-only و --schema=<name> داده‌ها را استخراج می‌کند.
 * - در صورت نیاز، جداول طرح‌واره مقصد را قبل از واردسازی پاک می‌کند تا تداخل یکتا پیش نیاید.
 * - اگر جدول‌های مقصد ناقص باشند، جدول‌هایِ جاافتاده را ایجاد می‌کند.
 * - هنگام ورود داده‌ها، موقتاً تریگرها را غیرفعال می‌کند تا چرخه‌های کلیدِ‌خارجی مشکل ایجاد نکنند.
 */
/**
 * Parse CLI args of the form:
 * --src=postgres://user:pass@host:port/db
 * --dest=postgres://user:pass@host:port/db
 * --schema=accounting
 * [--truncate]
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const out = {};
    for (const a of args) {
        if (a.startsWith('--src='))
            out.src = a.substring('--src='.length);
        else if (a.startsWith('--dest='))
            out.dest = a.substring('--dest='.length);
        else if (a.startsWith('--schema='))
            out.schema = a.substring('--schema='.length);
        else if (a === '--truncate')
            out.truncate = true;
        else if (a.startsWith('--dump='))
            out.dump = a.substring('--dump='.length);
    }
    return out;
}
/**
 * Ensure required binaries (pg_dump, psql) are available.
 * English: Returns true if found; logs guidance otherwise.
 * فارسی: در صورت نبودن ابزارها، راهنمای نصب را چاپ می‌کند.
 */
function checkBinaries() {
    const bins = ['pg_dump', 'psql'];
    let ok = true;
    for (const b of bins) {
        const res = (0, child_process_1.spawnSync)(b, ['--version'], { stdio: 'pipe' });
        if (res.status !== 0) {
            console.error(`[ERROR] Missing binary: ${b}. Install PostgreSQL client tools.`);
            ok = false;
        }
    }
    if (!ok) {
        console.error('macOS: brew install postgresql@18');
    }
    return ok;
}
/**
 * Parse connection options (host, port, user) from a Postgres URL.
 * English: Used to pass the right flags to psql.
 * فارسی: برای ارسال پارامترهای اتصال به psql.
 */
function parseConnOptions(url) {
    const u = new URL(url);
    return {
        host: u.hostname || 'localhost',
        port: u.port ? Number(u.port) : 5432,
        user: u.username || process.env.USER || undefined,
        db: (u.pathname || '').replace(/^\//, '').split('?')[0],
    };
}
/**
 * Dump source schema data to a SQL file using pg_dump.
 * English: Uses --schema=<name> and --data-only for rows only.
 * فارسی: فقط داده‌ها را برای طرح‌واره مشخص استخراج می‌کند.
 */
function dumpSchemaData(srcUrl, schema, dumpFile) {
    const dir = path.dirname(dumpFile);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    console.log(`[INFO] Exporting data from schema '${schema}' ...`);
    const u = new URL(srcUrl);
    const env = { ...process.env, PGPASSWORD: u.password || '' };
    const res = (0, child_process_1.spawnSync)('pg_dump', ['--no-owner', '--no-privileges', `--schema=${schema}`, '--data-only', srcUrl, '-f', dumpFile], { stdio: 'inherit', env });
    if (res.status !== 0) {
        throw new Error('pg_dump failed. Check SRC URL and that schema exists.');
    }
}
/**
 * Truncate all tables in a schema inside the destination database.
 * English: Queries pg_tables and runs a single TRUNCATE ... CASCADE.
 * فارسی: لیست جداول طرح‌واره را گرفته و همگی را یکجا پاک می‌کند.
 */
async function truncateTargetSchema(destUrl, schema) {
    console.log(`[INFO] Truncating destination schema '${schema}' tables (CASCADE) ...`);
    const pool = new pg_1.Pool({ connectionString: destUrl });
    try {
        const q = `SELECT tablename FROM pg_tables WHERE schemaname = $1`;
        const r = await pool.query(q, [schema]);
        const tables = r.rows.map((row) => `${schema}."${row.tablename}"`);
        if (tables.length === 0) {
            console.log('[WARN] No tables found to truncate. Skipping.');
            return;
        }
        const sql = `TRUNCATE TABLE ${tables.join(', ')} CASCADE;`;
        await pool.query(sql);
    }
    finally {
        await pool.end();
    }
}
/**
 * Restore the previously dumped schema data into the destination database.
 * English: Feeds the dump file into psql for the target DB.
 * فارسی: فایل استخراج‌شده را در بانک مقصد وارد می‌کند.
 */
function restoreSchemaData(destUrl, dumpFile, schemaForWrapper) {
    const { host, port, user, db } = parseConnOptions(destUrl);
    const u = new URL(destUrl);
    const env = { ...process.env, PGPASSWORD: u.password || '' };
    console.log(`[INFO] Importing data into destination DB '${db}' ...`);
    const wrapper = createWrapperForDataImport(schemaForWrapper, dumpFile);
    const res = (0, child_process_1.spawnSync)('psql', ['-h', host, '-p', String(port), ...(user ? ['-U', user] : []), db, '-v', 'ON_ERROR_STOP=1', '-f', wrapper], { stdio: 'inherit', env });
    if (res.status !== 0) {
        throw new Error('psql restore failed. Check DEST URL, permissions, and dump validity.');
    }
}
/**
 * Main entrypoint: dump → optional truncate → restore.
 * English: Copies data from src schema to dest schema in-place.
 * فارسی: داده‌های طرح‌واره را از مبدا به مقصد کپی می‌کند.
 */
async function main() {
    const { src, dest, schema, truncate, dump } = parseArgs();
    if (!src || !dest || !schema) {
        console.error('Usage: ts-node src/scripts/copySchema.ts --src=SRC_URL --dest=DEST_URL --schema=accounting [--truncate] [--dump=tmp/accounting_data.sql]');
        console.error('Example SRC: postgres://hsn:1qaz@localhost:5432/accounting?sslmode=disable');
        console.error('Example DEST: postgres://postgres:1qaz@localhost:5432/greenbunch?sslmode=disable');
        process.exit(1);
    }
    if (!checkBinaries())
        process.exit(2);
    // Ensure destination has all needed tables
    await ensureMissingTables(src, dest, schema);
    // Ensure existing tables have all required columns
    await ensureMissingColumns(src, dest, schema);
    // Align NOT NULL constraints where source allows NULL
    await ensureNullabilityCompatibility(src, dest, schema);
    // Relax dest-only NOT NULL columns without defaults
    await relaxDestExtraColumns(src, dest, schema);
    // Ensure sequences referenced in dump exist in destination
    await ensureMissingSequences(src, dest, schema);
    const dumpFile = dump || path.join(process.cwd(), 'tmp', `${schema}_data.sql`);
    dumpSchemaData(src, schema, dumpFile);
    if (truncate)
        await truncateTargetSchema(dest, schema);
    restoreSchemaData(dest, dumpFile, schema);
    console.log('[SUCCESS] Schema data copied successfully. | کپی داده‌های طرح‌واره با موفقیت انجام شد.');
}
/**
 * English: List base tables for a schema in a database.
 * فارسی: فهرستِ جدول‌های پایه در یک طرح‌واره.
 */
async function listSchemaTables(url, schema) {
    const pool = new pg_1.Pool({ connectionString: url });
    try {
        const r = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type='BASE TABLE' ORDER BY table_name`, [schema]);
        return r.rows.map((row) => row.table_name);
    }
    finally {
        await pool.end();
    }
}
/**
 * English: Dump DDL for a single table.
 * فارسی: استخراجِ ساختارِ یک جدول.
 */
function dumpTableStructure(srcUrl, schema, table, ddlFile) {
    const dir = path.dirname(ddlFile);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    const u = new URL(srcUrl);
    const env = { ...process.env, PGPASSWORD: u.password || '' };
    console.log(`[INFO] Exporting DDL for table ${schema}.${table} ...`);
    const res = (0, child_process_1.spawnSync)('pg_dump', ['--no-owner', '--no-privileges', `--schema=${schema}`, `--table=${schema}."${table}"`, '--schema-only', srcUrl, '-f', ddlFile], { stdio: 'inherit', env });
    if (res.status !== 0) {
        throw new Error(`pg_dump schema-only failed for table ${table}.`);
    }
}
/**
 * English: Restore DDL file into destination database.
 * فارسی: واردسازیِ ساختار جدول به پایگاه مقصد.
 */
function restoreDDLFile(destUrl, ddlFile) {
    const { host, port, user, db } = parseConnOptions(destUrl);
    const u = new URL(destUrl);
    const env = { ...process.env, PGPASSWORD: u.password || '' };
    const res = (0, child_process_1.spawnSync)('psql', ['-h', host, '-p', String(port), ...(user ? ['-U', user] : []), db, '-v', 'ON_ERROR_STOP=1', '-f', ddlFile], {
        stdio: 'inherit',
        env,
    });
    if (res.status !== 0) {
        throw new Error('psql DDL restore failed.');
    }
}
/**
 * English: Ensure that all source schema tables exist in destination.
 * فارسی: اطمینان از این‌که تمام جدول‌های طرح‌واره منبع، در مقصد وجود دارند.
 */
/**
 * English: Get FK edges within a schema (child -> parent).
 * فارسی: دریافت یال‌های کلیدِ‌خارجی درون طرح‌واره (فرزند → والد).
 */
async function getForeignKeyEdges(url, schema) {
    const pool = new pg_1.Pool({ connectionString: url });
    try {
        const q = `
      SELECT child.relname AS child, parent.relname AS parent
      FROM pg_constraint c
      JOIN pg_class child ON child.oid = c.conrelid
      JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
      JOIN pg_class parent ON parent.oid = c.confrelid
      JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
      WHERE c.contype = 'f' AND child_ns.nspname = $1 AND parent_ns.nspname = $1
    `;
        const r = await pool.query(q, [schema]);
        return r.rows.map((row) => ({ child: row.child, parent: row.parent }));
    }
    finally {
        await pool.end();
    }
}
/**
 * English: Topologically sort missing tables by FK parent-before-child order.
 * فارسی: مرتب‌سازی توپولوژیک جدول‌هایِ جاافتاده بر اساس تقدمِ والد به فرزند.
 */
function topoOrderMissingTables(missing, edges) {
    const missingSet = new Set(missing);
    const indegree = {};
    const adj = {};
    // Initialize
    for (const t of missing) {
        indegree[t] = 0;
        adj[t] = [];
    }
    // Build parent -> children graph using only missing nodes
    for (const { child, parent } of edges) {
        if (missingSet.has(child) && missingSet.has(parent)) {
            adj[parent].push(child);
            indegree[child] += 1;
        }
    }
    // Kahn's algorithm
    const queue = Object.keys(indegree).filter((t) => indegree[t] === 0);
    const order = [];
    while (queue.length) {
        const n = queue.shift();
        order.push(n);
        for (const m of adj[n]) {
            indegree[m] -= 1;
            if (indegree[m] === 0)
                queue.push(m);
        }
    }
    // If cycle or unresolved, append any remaining in arbitrary order
    if (order.length !== missing.length) {
        const orderedSet = new Set(order);
        for (const t of missing) {
            if (!orderedSet.has(t))
                order.push(t);
        }
    }
    return order;
}
async function ensureMissingTables(srcUrl, destUrl, schema) {
    let [srcTables, destTables, edges] = await Promise.all([
        listSchemaTables(srcUrl, schema),
        listSchemaTables(destUrl, schema),
        getForeignKeyEdges(srcUrl, schema),
    ]);
    let destSet = new Set(destTables);
    let missing = srcTables.filter((t) => !destSet.has(t));
    if (missing.length === 0) {
        console.log('[INFO] No missing tables detected.');
        return;
    }
    let ordered = topoOrderMissingTables(missing, edges);
    console.log(`[INFO] Creating ${ordered.length} missing table(s) in dependency order: ${ordered.join(', ')}`);
    const maxPasses = 4;
    for (let pass = 1; pass <= maxPasses; pass++) {
        console.log(`[INFO] DDL creation pass ${pass} ...`);
        for (const t of ordered) {
            // Skip if it already exists (created in a previous pass)
            if (destSet.has(t))
                continue;
            const ddlFile = path.join(process.cwd(), 'tmp', `${schema}_${t}_ddl.sql`);
            dumpTableStructure(srcUrl, schema, t, ddlFile);
            try {
                restoreDDLFile(destUrl, ddlFile);
            }
            catch (e) {
                console.warn(`[WARN] DDL restore failed for ${t}, will retry next pass: ${e.message}`);
            }
        }
        // Refresh destination tables and missing list
        destTables = await listSchemaTables(destUrl, schema);
        destSet = new Set(destTables);
        missing = srcTables.filter((t) => !destSet.has(t));
        if (missing.length === 0) {
            console.log('[INFO] All missing tables created.');
            break;
        }
        // Recompute edges and order for remaining
        edges = await getForeignKeyEdges(srcUrl, schema);
        ordered = topoOrderMissingTables(missing, edges);
    }
    if (missing.length > 0) {
        throw new Error(`Unable to create all missing tables after multiple passes: ${missing.join(', ')}`);
    }
}
/**
 * English: Create a wrapper file to import data with triggers disabled.
 * فارسی: ایجاد فایلِ واسط برای واردسازیِ داده با تریگرهای غیرفعال.
 */
function createWrapperForDataImport(schema, dumpFile) {
    const wrapper = path.join(process.cwd(), 'tmp', `${schema}_import_wrapper.sql`);
    const absDump = path.resolve(dumpFile);
    const content = [
        `SET search_path TO ${schema}, public;`,
        `SET session_replication_role = replica;`,
        `\\i ${absDump}`,
        `SET session_replication_role = origin;`,
    ].join('\n');
    fs.mkdirSync(path.dirname(wrapper), { recursive: true });
    fs.writeFileSync(wrapper, content, 'utf8');
    return wrapper;
}
async function schemaHasTables(destUrl, schema) {
    const pool = new pg_1.Pool({ connectionString: destUrl });
    try {
        const r = await pool.query('SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname = $1', [schema]);
        return Number(r.rows[0].n) > 0;
    }
    finally {
        await pool.end();
    }
}
// Execute main
main();
/**
 * English: Get column definitions for a table using pg_catalog.
 * فارسی: دریافتِ تعریف ستون‌های جدول با استفاده از pg_catalog.
 */
async function getTableColumns(url, schema, table) {
    const pool = new pg_1.Pool({ connectionString: url });
    try {
        const q = `
      SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type
      FROM pg_attribute a
      JOIN pg_class c ON a.attrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum
    `;
        const r = await pool.query(q, [schema, table]);
        const m = new Map();
        for (const row of r.rows) {
            m.set(row.name, { type: row.type });
        }
        return m;
    }
    finally {
        await pool.end();
    }
}
/**
 * English: Run an inline SQL command on destination via psql.
 * فارسی: اجرای دستورِ SQL در مقصد با psql.
 */
function runPsqlInline(destUrl, sql) {
    const { host, port, user, db } = parseConnOptions(destUrl);
    const u = new URL(destUrl);
    const env = { ...process.env, PGPASSWORD: u.password || '' };
    const res = (0, child_process_1.spawnSync)('psql', ['-h', host, '-p', String(port), ...(user ? ['-U', user] : []), db, '-v', 'ON_ERROR_STOP=1', '-c', sql], {
        stdio: 'inherit',
        env,
    });
    if (res.status !== 0) {
        throw new Error('psql inline SQL failed.');
    }
}
/**
 * English: Ensure destination tables have all columns present in source; add missing columns as NULLable.
 * فارسی: اطمینان از وجود همهٔ ستون‌ها در مقصد؛ ستون‌هایِ جاافتاده به‌صورت NULLable افزوده می‌شوند.
 */
async function ensureMissingColumns(srcUrl, destUrl, schema) {
    const [srcTables, destTables] = await Promise.all([
        listSchemaTables(srcUrl, schema),
        listSchemaTables(destUrl, schema),
    ]);
    const destSet = new Set(destTables);
    const common = srcTables.filter((t) => destSet.has(t));
    for (const t of common) {
        const [srcCols, destCols] = await Promise.all([
            getTableColumns(srcUrl, schema, t),
            getTableColumns(destUrl, schema, t),
        ]);
        const missingCols = [];
        for (const [name, info] of srcCols.entries()) {
            if (!destCols.has(name))
                missingCols.push({ name, type: info.type });
        }
        if (missingCols.length === 0)
            continue;
        const adds = missingCols.map((c) => `ADD COLUMN "${c.name}" ${c.type}`).join(', ');
        const sql = `ALTER TABLE ${schema}."${t}" ${adds};`;
        console.log(`[INFO] Adding ${missingCols.length} missing column(s) on ${schema}.${t}: ${missingCols.map((c) => c.name).join(', ')}`);
        runPsqlInline(destUrl, sql);
    }
}
/**
 * English: Get column nullability for a table.
 * فارسی: دریافت وضعیت NOT NULL ستون‌هایِ جدول.
 */
async function getColumnNullability(url, schema, table) {
    const pool = new pg_1.Pool({ connectionString: url });
    try {
        const q = `
      SELECT a.attname AS name, a.attnotnull AS notnull
      FROM pg_attribute a
      JOIN pg_class c ON a.attrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum
    `;
        const r = await pool.query(q, [schema, table]);
        const m = new Map();
        for (const row of r.rows)
            m.set(row.name, row.notnull);
        return m;
    }
    finally {
        await pool.end();
    }
}
/**
 * English: Relax NOT NULL constraints in destination when source allows NULL.
 * فارسی: اگر در منبع ستون NULLپذیر باشد ولی در مقصد NOT NULL؛ محدودیت را حذف می‌کنیم.
 */
async function ensureNullabilityCompatibility(srcUrl, destUrl, schema) {
    const [srcTables, destTables] = await Promise.all([
        listSchemaTables(srcUrl, schema),
        listSchemaTables(destUrl, schema),
    ]);
    const destSet = new Set(destTables);
    const common = srcTables.filter((t) => destSet.has(t));
    for (const t of common) {
        const [srcNulls, destNulls] = await Promise.all([
            getColumnNullability(srcUrl, schema, t),
            getColumnNullability(destUrl, schema, t),
        ]);
        const toRelax = [];
        for (const [name, srcNotNull] of srcNulls.entries()) {
            const destNotNull = destNulls.get(name);
            if (destNotNull === true && srcNotNull === false)
                toRelax.push(name);
        }
        if (toRelax.length === 0)
            continue;
        for (const col of toRelax) {
            const sql = `ALTER TABLE ${schema}."${t}" ALTER COLUMN "${col}" DROP NOT NULL;`;
            console.log(`[INFO] Dropping NOT NULL on ${schema}.${t}.${col} to match source nullability.`);
            runPsqlInline(destUrl, sql);
        }
    }
}
/**
 * English: Get column default expressions for a table.
 * فارسی: دریافت عبارت پیش‌فرض ستون‌های جدول.
 */
async function getColumnDefaults(url, schema, table) {
    const pool = new pg_1.Pool({ connectionString: url });
    try {
        const q = `
      SELECT a.attname AS name, pg_get_expr(d.adbin, d.adrelid) AS def
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      JOIN pg_class c ON a.attrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum
    `;
        const r = await pool.query(q, [schema, table]);
        const m = new Map();
        for (const row of r.rows)
            m.set(row.name, row.def ?? null);
        return m;
    }
    finally {
        await pool.end();
    }
}
/**
 * English: For dest-only columns without defaults, drop NOT NULL to allow COPY with column lists.
 * فارسی: برای ستون‌هایِ اضافیِ مقصد که پیش‌فرض ندارند، NOT NULL را حذف می‌کنیم تا COPY با فهرست ستون‌ها موفق شود.
 */
async function relaxDestExtraColumns(srcUrl, destUrl, schema) {
    const [srcTables, destTables] = await Promise.all([
        listSchemaTables(srcUrl, schema),
        listSchemaTables(destUrl, schema),
    ]);
    const destSet = new Set(destTables);
    const common = srcTables.filter((t) => destSet.has(t));
    for (const t of common) {
        const [srcCols, destCols, destNulls, destDefs] = await Promise.all([
            getTableColumns(srcUrl, schema, t),
            getTableColumns(destUrl, schema, t),
            getColumnNullability(destUrl, schema, t),
            getColumnDefaults(destUrl, schema, t),
        ]);
        const srcNames = new Set([...srcCols.keys()]);
        const destNames = new Set([...destCols.keys()]);
        const extra = [];
        for (const name of destNames) {
            if (!srcNames.has(name))
                extra.push(name);
        }
        if (extra.length === 0)
            continue;
        for (const col of extra) {
            const notnull = destNulls.get(col) === true;
            const hasDefault = !!destDefs.get(col);
            if (notnull && !hasDefault) {
                const sql = `ALTER TABLE ${schema}."${t}" ALTER COLUMN "${col}" DROP NOT NULL;`;
                console.log(`[INFO] Dropping NOT NULL on dest-only column ${schema}.${t}.${col} (no default in dest, not present in src).`);
                runPsqlInline(destUrl, sql);
            }
        }
    }
}
/**
 * English: List sequence names in a schema.
 * فارسی: فهرست نام‌هایِ سکوئنس‌ها در یک طرح‌واره.
 */
async function listSchemaSequences(url, schema) {
    const pool = new pg_1.Pool({ connectionString: url });
    try {
        const r = await pool.query(`SELECT c.relname AS sequence_name
       FROM pg_class c
       JOIN pg_namespace n ON c.relnamespace = n.oid
       WHERE n.nspname = $1 AND c.relkind = 'S'
       ORDER BY c.relname`, [schema]);
        return r.rows.map((row) => row.sequence_name);
    }
    finally {
        await pool.end();
    }
}
/**
 * English: Create sequences that exist in source schema but missing in destination.
 * فارسی: ایجادِ سکوئنس‌هایِ موجود در منبع که در مقصد نیستند.
 */
async function ensureMissingSequences(srcUrl, destUrl, schema) {
    const [srcSeqs, destSeqs] = await Promise.all([
        listSchemaSequences(srcUrl, schema),
        listSchemaSequences(destUrl, schema),
    ]);
    const destSet = new Set(destSeqs);
    const missing = srcSeqs.filter((s) => !destSet.has(s));
    if (missing.length === 0) {
        console.log('[INFO] No missing sequences detected.');
        return;
    }
    for (const s of missing) {
        const sql = `CREATE SEQUENCE ${schema}."${s}";`;
        console.log(`[INFO] Creating missing sequence ${schema}.${s}`);
        runPsqlInline(destUrl, sql);
    }
}
