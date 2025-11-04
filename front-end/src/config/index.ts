import.meta.env; // Ensure Vite loads env

/**
 * Config for Accounting front-end.
 * Mirrors admin approach for BASE_URL and API endpoints.
 */
const devAuto = import.meta.env.VITE_DEV_AUTO_LOGIN === 'true' || false;
const envBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
const BASE_URL = envBase && envBase.length > 0 ? envBase : (devAuto ? 'http://localhost:4100' : 'https://greenbunch.ir');

const config = {
  BASE_URL,
  API_BASE_URL: BASE_URL,
  API_ENDPOINTS: {
    base: `${BASE_URL}/api`,
    auth: `${BASE_URL}/api/auth`,
    users: `${BASE_URL}/api/users`,
  }
};

export default config;
export { config };