"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Quick PostgreSQL connectivity check using node-postgres (pg).
 * - Loads env via dotenv and uses `DATABASE_URL`.
 * - Queries server version, current database, and current timestamp.
 * - Prints a concise result and exits.
 */
const dotenv_1 = __importDefault(require("dotenv"));
const pg_1 = require("pg");
dotenv_1.default.config();
/**
 * Execute a simple query (`SELECT version(), current_database(), NOW()`).
 */
async function testConnection() {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error('DATABASE_URL is not set in .env');
        process.exit(1);
    }
    const pool = new pg_1.Pool({ connectionString: url });
    try {
        const r = await pool.query('SELECT version() as version, current_database() as db, NOW() as now');
        const row = r.rows[0];
        console.log(JSON.stringify({ ok: true, db: row.db, version: row.version, now: row.now }));
        process.exit(0);
    }
    catch (e) {
        console.error(JSON.stringify({ ok: false, error: e.message }));
        process.exit(1);
    }
    finally {
        pool.end().catch(() => { });
    }
}
// Run the test
void testConnection();
