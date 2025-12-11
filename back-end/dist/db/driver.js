"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureSchema = ensureSchema;
exports.upsertUserByMobile = upsertUserByMobile;
exports.storeRefreshToken = storeRefreshToken;
exports.revokeRefreshToken = revokeRefreshToken;
exports.findRefreshToken = findRefreshToken;
exports.pingDb = pingDb;
/**
 * Postgres-only DB driver interface.
 * Provides a uniform API for persistence without SQLite fallback.
 * Functions proxy directly to Postgres helpers in `db/pg.ts`.
 */
const pg_1 = require("./pg");
/**
 * Ensure the Postgres schema exists.
 * Safe to call multiple times; uses idempotent DDL in `pg.ensureSchema`.
 */
async function ensureSchema() {
    return (0, pg_1.ensureSchema)();
}
/**
 * Upsert a user by mobile number in Postgres.
 * Returns the user's id (new or existing).
 */
async function upsertUserByMobile(mobileNumber) {
    return (0, pg_1.upsertUserByMobile)(mobileNumber);
}
/**
 * Store a refresh token row with expiry in Postgres.
 */
async function storeRefreshToken(token, userId, expiresAtMs) {
    return (0, pg_1.storeRefreshToken)(token, userId, expiresAtMs);
}
/**
 * Mark a refresh token revoked in Postgres.
 */
async function revokeRefreshToken(token) {
    return (0, pg_1.revokeRefreshToken)(token);
}
/**
 * Find a refresh token joined to user mobile number in Postgres.
 */
async function findRefreshToken(token) {
    return (0, pg_1.findRefreshToken)(token);
}
/**
 * Ping Postgres connectivity for health checks.
 * Returns `{ ok, driver: 'postgres' }` with optional info.
 */
async function pingDb() {
    return (0, pg_1.ping)();
}
