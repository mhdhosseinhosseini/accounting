/**
 * Postgres-only DB driver interface.
 * Provides a uniform API for persistence without SQLite fallback.
 * Functions proxy directly to Postgres helpers in `db/pg.ts`.
 */
import { ensureSchema as pgEnsure, upsertUserByMobile as pgUpsert, storeRefreshToken as pgStore, findRefreshToken as pgFind, revokeRefreshToken as pgRevoke, ping as pgPing } from './pg';

/**
 * Ensure the Postgres schema exists.
 * Safe to call multiple times; uses idempotent DDL in `pg.ensureSchema`.
 */
export async function ensureSchema(): Promise<void> {
  return pgEnsure();
}

/**
 * Upsert a user by mobile number in Postgres.
 * Returns the user's id (new or existing).
 */
export async function upsertUserByMobile(mobileNumber: string): Promise<{ id: string }>{
  return pgUpsert(mobileNumber);
}

/**
 * Store a refresh token row with expiry in Postgres.
 */
export async function storeRefreshToken(token: string, userId: string, expiresAtMs: number): Promise<void> {
  return pgStore(token, userId, expiresAtMs);
}

/**
 * Mark a refresh token revoked in Postgres.
 */
export async function revokeRefreshToken(token: string): Promise<void> {
  return pgRevoke(token);
}

/**
 * Find a refresh token joined to user mobile number in Postgres.
 */
export async function findRefreshToken(token: string): Promise<{ token: string; revoked: boolean; expires_at: Date; mobile_number: string } | null> {
  return pgFind(token);
}

/**
 * Ping Postgres connectivity for health checks.
 * Returns `{ ok, driver: 'postgres' }` with optional info.
 */
export async function pingDb(): Promise<{ ok: boolean; driver: 'postgres'; info?: any }>{
  return pgPing();
}