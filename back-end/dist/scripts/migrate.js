"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const pg_1 = require("../db/pg");
/**
 * Run Postgres database migrations.
 * - Reads SQL files from migrations/postgres ordered by filename.
 * - Creates a `schema_migrations` table to track applied versions.
 * - Applies missing migrations idempotently.
 * - Logs messages in English and Farsi for bilingual visibility.
 */
async function run() {
    const baseDir = path_1.default.resolve(__dirname, '../../migrations/postgres');
    if (!fs_1.default.existsSync(baseDir)) {
        console.error(`Migrations directory not found: ${baseDir}`);
        console.error('پوشه مهاجرت پایگاه‌داده پیدا نشد.');
        process.exit(1);
    }
    const files = fs_1.default
        .readdirSync(baseDir)
        .filter((f) => f.endsWith('.sql'))
        .sort((a, b) => a.localeCompare(b));
    if (files.length === 0) {
        console.log('No migration files to apply.');
        console.log('فایلی برای مهاجرت وجود ندارد.');
        return;
    }
    await migratePostgres(baseDir, files);
    console.log('Migrations applied successfully.');
    console.log('مهاجرت‌ها با موفقیت اعمال شدند.');
}
/**
 * Ensure the schema_migrations table exists in Postgres.
 * Creates the table if absent using idempotent DDL.
 */
async function ensureMigrationsTablePostgres() {
    const p = (0, pg_1.getPool)();
    await p.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}
/**
 * Get the set of applied migration versions in Postgres.
 * Returns a Set of version strings present in schema_migrations.
 */
async function getAppliedPostgres() {
    const p = (0, pg_1.getPool)();
    const res = await p.query('SELECT version FROM schema_migrations');
    return new Set(res.rows.map((r) => r.version));
}
/**
 * Apply migrations for Postgres.
 * Iterates ordered SQL files and applies any missing versions.
 */
async function migratePostgres(baseDir, files) {
    await ensureMigrationsTablePostgres();
    const applied = await getAppliedPostgres();
    const p = (0, pg_1.getPool)();
    for (const file of files) {
        const version = path_1.default.basename(file, '.sql');
        if (applied.has(version)) {
            console.log(`Skip ${version} (already applied).`);
            console.log(`رد شد ${version} (قبلاً اعمال شده).`);
            continue;
        }
        const sql = fs_1.default.readFileSync(path_1.default.join(baseDir, file), 'utf-8');
        console.log(`Applying ${version}...`);
        console.log(`در حال اعمال ${version}...`);
        try {
            await p.query(sql);
            await p.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        }
        catch (err) {
            console.error(`Failed to apply ${version}:`, err);
            console.error(`اعمال ${version} ناموفق بود:`, err?.message || err);
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
