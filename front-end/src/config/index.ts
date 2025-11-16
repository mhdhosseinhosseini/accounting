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

const config = {
  // Host base (without duplicate trailing slashes)
  BASE_URL: NORMALIZED_BASE,
  // API base URL (guaranteed single '/api' suffix)
  API_BASE_URL: API_BASE,
  API_ENDPOINTS: {
    base: API_BASE,
    auth: `${API_BASE}/auth`,
    users: `${API_BASE}/users`,
  }
};

export default config;
export { config };