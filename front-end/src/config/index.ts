/**
 * Config for Accounting front-end.
 * Resolves API base URL robustly, avoiding duplicate '/api' segments.
 */
const devAuto = import.meta.env.VITE_DEV_AUTO_LOGIN === 'true' || false;
const envBase = import.meta.env.VITE_API_BASE_URL as string | undefined;

// Determine raw base URL (may or may not include '/api')
const RAW_BASE_URL = envBase && envBase.length > 0
  ? envBase
  : (devAuto ? 'http://localhost:4100' : 'https://greenbunch.ir');

// Normalize: remove trailing slashes, detect if '/api' is already present
const NORMALIZED_BASE = RAW_BASE_URL.replace(/\/+$/, '');
const HAS_API_SUFFIX = /\/api$/i.test(NORMALIZED_BASE);

// Compute API base reliably: append '/api' only if not already present
const API_BASE = HAS_API_SUFFIX ? NORMALIZED_BASE : `${NORMALIZED_BASE}/api`;

/**
 * Digit length configuration for codes, driven by env variables.
 * Parses positive integers and falls back to sensible defaults (2/4/6).
 */
function parseDigits(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}
const GROUP_DIGITS = parseDigits(import.meta.env.VITE_GROUP_CODE_DIGITS, 2);
const GENERAL_DIGITS = parseDigits(import.meta.env.VITE_GENERAL_CODE_DIGITS, 4);
const SPECIFIC_DIGITS = parseDigits(import.meta.env.VITE_SPECIFIC_CODE_DIGITS, 6);

/**
 * normalizedEnvCode
 * Reads a default special code from env, returning a trimmed string.
 * Returns empty string when unset, allowing callers to check truthiness.
 */
function normalizedEnvCode(v: unknown): string {
  const s = String(v ?? '').trim();
  return s;
}
const DEFAULT_RECEIPT_SPECIAL_CODE = normalizedEnvCode(import.meta.env.VITE_DEFAULT_RECEIPT_SPECIAL_CODE);



const DEFAULT_PAYMENT_SPECIAL_CODE = normalizedEnvCode(import.meta.env.VITE_DEFAULT_PAYMENT_SPECIAL_CODE);
const BANK_DETAIL_START_CODE = normalizedEnvCode(import.meta.env.VITE_BANK_DETAIL_START_CODE);

const config = {
  // Host base (without duplicate trailing slashes)
  BASE_URL: NORMALIZED_BASE,
  // API base URL (guaranteed single '/api' suffix)
  API_BASE_URL: API_BASE,
  API_ENDPOINTS: {
    base: API_BASE,
    auth: `${API_BASE}/auth`,
    users: `${API_BASE}/users`,
  },
  /**
   * Required digit counts for codes.
   * - group: digits for group codes
   * - general: digits for general codes
   * - specific: digits for specific codes
   */
  CODE_DIGITS: {
    group: GROUP_DIGITS,
    general: GENERAL_DIGITS,
    specific: SPECIFIC_DIGITS,
  },
  /**
   * Default special codes (string format), sourced from environment.
   * Empty string indicates no default configured.
   */
  DEFAULT_CODES: {
    receiptSpecial: DEFAULT_RECEIPT_SPECIAL_CODE,
    paymentSpecial: DEFAULT_PAYMENT_SPECIAL_CODE,
    bankDetailStart: BANK_DETAIL_START_CODE,
  },
};

export default config;
export { config };