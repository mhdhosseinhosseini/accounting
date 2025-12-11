"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const crypto_1 = require("crypto");
const driver_1 = require("../db/driver");
const pg_1 = require("../db/pg");
/**
 * Seed minimal data for Postgres driver.
 * - Creates base roles, current fiscal year, and root account categories.
 * - Idempotent: uses upsert semantics to avoid duplicates.
 * - Notes: Fiscal year uses Gregorian year boundaries (Jan 1–Dec 31) by default.
 */
async function main() {
    await (0, driver_1.ensureSchema)();
    await seedPostgres();
    // Bilingual confirmation logs
    console.log('Seed completed successfully.');
    console.log('مقداردهی اولیه با موفقیت انجام شد.');
}
/**
 * Seed data for Postgres driver.
 * Inserts roles, a fiscal year, and base accounts using ON CONFLICT for idempotence.
 */
async function seedPostgres() {
    const p = (0, pg_1.getPool)();
    // Roles
    const roles = ['admin', 'user'];
    for (const name of roles) {
        await p.query(`INSERT INTO roles (id, name) VALUES ($1, $2)
       ON CONFLICT (name) DO NOTHING`, [(0, crypto_1.randomUUID)(), name]);
    }
    // Fiscal Year
    const now = new Date();
    const year = now.getFullYear();
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    await p.query(`INSERT INTO fiscal_years (id, name, start_date, end_date, is_closed)
     VALUES ($1, $2, $3, $4, FALSE)
     ON CONFLICT (id) DO NOTHING`, [(0, crypto_1.randomUUID)(), `FY-${year}`, start, end]);
    // Base Accounts
    const accounts = [
        { code: '1000', name: 'Assets', type: 'asset' },
        { code: '2000', name: 'Liabilities', type: 'liability' },
        { code: '3000', name: 'Equity', type: 'equity' },
        { code: '4000', name: 'Revenue', type: 'revenue' },
        { code: '5000', name: 'Expenses', type: 'expense' },
    ];
    for (const a of accounts) {
        await p.query(`INSERT INTO accounts (id, code, name, level, type)
       VALUES ($1, $2, $3, 0, $4)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`, [(0, crypto_1.randomUUID)(), a.code, a.name, a.type]);
    }
    console.log('Seeded roles, fiscal_year, and base accounts (Postgres).');
    console.log('نقش‌ها، سال مالی و حساب‌های پایه در پستگرس مقداردهی شدند.');
}
// Execute seeds
main().catch((err) => {
    console.error('Seed failed:', err);
    console.error('خطا در مقداردهی اولیه:', err?.message || err);
    process.exit(1);
});
