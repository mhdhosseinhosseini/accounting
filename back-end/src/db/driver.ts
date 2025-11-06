/**
 * DB driver selector providing a uniform interface for persistence.
 * - Uses `DB_DRIVER` env: 'sqlite' or 'postgres' (default 'postgres').
 * - Exposes ensureSchema, upsertUserByMobile, storeRefreshToken, findRefreshToken, revokeRefreshToken.
 */
import type { Pool } from 'pg';
import { ensureSchema as pgEnsure, upsertUserByMobile as pgUpsert, storeRefreshToken as pgStore, findRefreshToken as pgFind, revokeRefreshToken as pgRevoke, ping as pgPing } from './pg';
import { ensureSchema as sqliteEnsure, upsertUserByMobile as sqliteUpsert, storeRefreshToken as sqliteStore, findRefreshToken as sqliteFind, revokeRefreshToken as sqliteRevoke, ping as sqlitePing } from './sqlite';

/**
 * Select driver based on env.
 */
function isSqlite(): boolean {
  const drv = (process.env.DB_DRIVER || '').toLowerCase();
  return drv === 'sqlite';
}

/**
 * Ensure schema for the chosen driver.
 */
export async function ensureSchema(): Promise<void> {
  if (isSqlite()) return sqliteEnsure();
  return pgEnsure();
}

/**
 * Upsert user by mobile number.
 */
export async function upsertUserByMobile(mobileNumber: string): Promise<{ id: string }>{
  if (isSqlite()) return sqliteUpsert(mobileNumber);
  return pgUpsert(mobileNumber);
}

/**
 * Store a refresh token row.
 */
export async function storeRefreshToken(token: string, userId: string, expiresAtMs: number): Promise<void> {
  if (isSqlite()) return sqliteStore(token, userId, expiresAtMs);
  return pgStore(token, userId, expiresAtMs);
}

/**
 * Revoke a refresh token.
 */
export async function revokeRefreshToken(token: string): Promise<void> {
  if (isSqlite()) return sqliteRevoke(token);
  return pgRevoke(token);
}

/**
 * Find a refresh token with user mobile number.
 */
export async function findRefreshToken(token: string): Promise<{ token: string; revoked: boolean; expires_at: Date; mobile_number: string } | null> {
  if (isSqlite()) return sqliteFind(token);
  return pgFind(token);
}

/**
 * Ping the active database driver.
 */
export async function pingDb(): Promise<{ ok: boolean; driver: 'sqlite' | 'postgres'; info?: any }>{
  if (isSqlite()) return sqlitePing();
  return pgPing();
}