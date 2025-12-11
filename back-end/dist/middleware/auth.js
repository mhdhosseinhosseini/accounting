"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const i18n_1 = require("../i18n");
/**
 * Extract language from request, defaulting to English.
 */
function getLang(req) {
    const raw = (req.headers['accept-language'] || '').toString().toLowerCase();
    return raw.startsWith('fa') ? 'fa' : 'en';
}
/**
 * Robustly extract an access token from the request.
 * Supports:
 * - Authorization header (Bearer <token> or raw token)
 * - x-access-token header
 * - Query params: access_token, token
 * - Cookie header: token, access_token, Authorization
 */
function extractTokenFromRequest(req) {
    // Authorization header
    const auth = (req.headers.authorization || '').toString();
    if (auth) {
        if (auth.startsWith('Bearer '))
            return auth.slice(7);
        if (auth.startsWith('Token '))
            return auth.slice(6);
        // If header contains a raw token without prefix
        if (auth.length > 10 && !auth.includes(' '))
            return auth;
    }
    // x-access-token header
    const xToken = (req.headers['x-access-token'] || '').toString();
    if (xToken)
        return xToken;
    // Query params
    const q = req.query || {};
    if (typeof q.access_token === 'string' && q.access_token.length > 0)
        return q.access_token;
    if (typeof q.token === 'string' && q.token.length > 0)
        return q.token;
    // Cookies
    const cookieHeader = (req.headers.cookie || '').toString();
    if (cookieHeader) {
        const pairs = cookieHeader.split(';').map((p) => p.trim());
        const findVal = (key) => {
            const pref = key + '=';
            const m = pairs.find((p) => p.startsWith(pref));
            return m ? decodeURIComponent(m.slice(pref.length)) : null;
        };
        const cAuth = findVal('Authorization');
        if (cAuth) {
            if (cAuth.startsWith('Bearer '))
                return cAuth.slice(7);
            if (cAuth.startsWith('Token '))
                return cAuth.slice(6);
            if (cAuth.length > 10 && !cAuth.includes(' '))
                return cAuth;
        }
        const c1 = findVal('token');
        if (c1)
            return c1;
        const c2 = findVal('access_token');
        if (c2)
            return c2;
    }
    return null;
}
/**
 * Localized messages used by the auth middleware.
 */
function msg(key, lang) {
    // Use i18n for known keys; provide safe fallbacks otherwise
    if (key === 'invalidToken')
        return (0, i18n_1.t)('auth.invalidToken', lang);
    const dict = {
        unauthorized: { fa: 'دسترسی مجاز نیست', en: 'Unauthorized' },
        invalidToken: { fa: 'توکن نامعتبر یا منقضی است', en: 'Invalid or expired token' },
    };
    return dict[key][lang];
}
const jwtSecret = process.env.JWT_SECRET || 'dev-secret';
/**
 * Require a valid JWT access token to proceed.
 * Attaches `{ mobileNumber, role }` to `req.user` when valid.
 */
function requireAuth(req, res, next) {
    const lang = req.lang || getLang(req);
    const token = extractTokenFromRequest(req);
    if (!token) {
        return res.status(401).json({ ok: false, message: msg('unauthorized', lang) });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, jwtSecret);
        req.user = { mobileNumber: decoded.sub, role: decoded.role };
        return next();
    }
    catch {
        return res.status(401).json({ ok: false, message: msg('invalidToken', lang) });
    }
}
