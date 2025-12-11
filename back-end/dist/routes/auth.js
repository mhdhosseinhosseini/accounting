"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
/**
 * Auth routes implementing OTP request and verification for Accounting backend.
 * Follows the server project's approach, simplified without DB.
 * - POST /request-otp: validates mobile, generates 6-digit OTP, stores in memory, sends SMS.
 * - POST /verify-otp: validates OTP, returns a token and minimal user object.
 * Notes:
 * - Accept-Language header is used to localize responses (fa/en).
 * - In-memory store resets on server restart; suitable for development environments.
 */
const express_1 = require("express");
const zod_1 = require("zod");
const smsService_1 = require("../services/smsService");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const driver_1 = require("../db/driver");
const i18n_1 = require("../i18n");
// In-memory OTP store: mobile -> { code, expiresAt }
const otpStore = new Map();
const router = (0, express_1.Router)();
exports.authRouter = router;
// OTP request rate limiter using env-configured max per minute
/**
 * Protect OTP endpoint from abuse with a simple rate limiter per IP.
 * Allow disabling in development via DISABLE_OTP_RATE_LIMIT=true
 */
const disableOtpRateLimit = String(process.env.DISABLE_OTP_RATE_LIMIT || '').toLowerCase() === 'true';
const otpLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_REQUEST_OTP_PER_MIN ?? '5', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: (req) => ({ ok: false, message: (0, i18n_1.t)('auth.tooManyRequests', getLang(req)) }),
});
const otpLimiterMiddleware = disableOtpRateLimit ? ((req, res, next) => next()) : otpLimiter;
/**
 * Additional per-mobile rate limit to reduce OTP abuse.
 * Window: 10 minutes; Limit configurable via RATE_LIMIT_REQUEST_OTP_PER_MOBILE_PER_10M (default 5).
 */
const mobileWindowMs = 10 * 60 * 1000;
const mobileMax = parseInt(process.env.RATE_LIMIT_REQUEST_OTP_PER_MOBILE_PER_10M ?? '5', 10);
const mobileLimits = new Map();
const jwtSecret = process.env.JWT_SECRET || 'dev-secret';
const accessExpiresIn = process.env.JWT_EXPIRES_IN || '15m';
const refreshExpiresIn = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
// Removed in-memory refresh store; now persisted in DB via Prisma.
/**
 * Parse a duration string like "15m", "7d", or seconds to numeric seconds.
 */
function parseExpires(value) {
    const m = value.match(/^(\d+)([smhd])$/);
    if (!m)
        return parseInt(value, 10);
    const num = parseInt(m[1], 10);
    const unit = m[2];
    const unitMap = { s: 1, m: 60, h: 3600, d: 86400 };
    return num * (unitMap[unit] || 1);
}
/**
 * Issue tokens and persist refresh token using direct SQL (Postgres via driver).
 * Ensures schema, upserts user by mobile, stores refresh token with expiry.
 * In development, when `DISABLE_REFRESH_PERSISTENCE=true`, skips DB writes but still returns tokens.
 */
async function issueTokensForMobile(mobileNumber) {
    await (0, driver_1.ensureSchema)();
    const user = await (0, driver_1.upsertUserByMobile)(mobileNumber);
    const payload = { sub: mobileNumber, role: 'user' };
    const accessToken = jsonwebtoken_1.default.sign(payload, jwtSecret, { expiresIn: parseExpires(accessExpiresIn) });
    const refreshToken = jsonwebtoken_1.default.sign({ sub: mobileNumber, type: 'refresh' }, jwtSecret, { expiresIn: parseExpires(refreshExpiresIn) });
    const disablePersist = String(process.env.DISABLE_REFRESH_PERSISTENCE || '').toLowerCase() === 'true';
    if (!disablePersist) {
        try {
            const decoded = jsonwebtoken_1.default.decode(refreshToken);
            const expMs = decoded?.exp ? decoded.exp * 1000 : Date.now() + 7 * 24 * 60 * 60 * 1000;
            await (0, driver_1.storeRefreshToken)(refreshToken, user.id, expMs);
        }
        catch {
            // Gracefully ignore persistence failure in development to avoid blocking login
        }
    }
    return { accessToken, refreshToken };
}
/**
 * Helper: get language from Accept-Language header.
 */
function getLang(req) {
    const raw = (req.headers['accept-language'] || '').toString().toLowerCase();
    if (raw.startsWith('fa'))
        return 'fa';
    return 'en';
}
/**
 * Helper: localized messages.
 */
// Removed unused msg() helper (t() is used for i18n messages)
// Removed unused RequestOtpSchema and VerifyOtpSchema (inline schemas are used in handlers)
/**
 * POST /api/auth/request-otp
 * Generates a 6-digit OTP for the provided mobile number,
 * persists it in the in-memory store with a 2-minute expiry,
 * and attempts to send via Magfa SMS if credentials are configured.
 * - In production (SMS configured): returns 500 on SMS failure.
 * - In development (no SMS configured): logs failure and returns ok with debugCode.
 * Responses are localized based on the Accept-Language header (fa/en).
 */
router.post('/request-otp', otpLimiterMiddleware, async (req, res) => {
    const lang = req.lang || getLang(req);
    const parse = zod_1.z.object({ mobileNumber: zod_1.z.string().regex(/^09\d{9}$/) }).safeParse(req.body);
    if (!parse.success) {
        return res.status(400).json({ ok: false, message: (0, i18n_1.t)('auth.invalidMobile', lang) });
    }
    const { mobileNumber } = parse.data;
    // Per-mobile limiter (skip when DISABLE_OTP_RATE_LIMIT=true)
    if (!disableOtpRateLimit) {
        const now = Date.now();
        const mEntry = mobileLimits.get(mobileNumber);
        if (!mEntry || now > mEntry.resetAt) {
            mobileLimits.set(mobileNumber, { count: 1, resetAt: now + mobileWindowMs });
        }
        else if (mEntry.count >= mobileMax) {
            return res.status(429).json({ ok: false, message: (0, i18n_1.t)('auth.tooManyRequests', lang) });
        }
        else {
            mEntry.count += 1;
        }
    }
    // Determine if SMS provider is configured (production behavior)
    // Dev override: when DEV_FORCE_DEBUG_OTP=true, treat SMS as not configured and expose debugCode
    const devForceDebug = String(process.env.DEV_FORCE_DEBUG_OTP || '').toLowerCase() === 'true';
    const isConfigured = !devForceDebug && !!(process.env.MAGFA_USERNAME && process.env.MAGFA_PASSWORD && process.env.MAGFA_DOMAIN);
    // Generate a 6-digit OTP and store with 2 minutes expiry
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + 2 * 60 * 1000; // 2 minutes
    otpStore.set(mobileNumber, { code, expiresAt });
    // Removed console.log for lint; rely on debugCode in dev mode
    const result = await smsService_1.smsService.sendOtp(mobileNumber, code);
    if (!result.success) {
        if (isConfigured) {
            // In production, fail the request so user isn't stuck without SMS
            return res.status(500).json({ ok: false, message: result.error || (0, i18n_1.t)('auth.tooManyRequests', lang) });
        }
        // Dev fallback: continue without logging
    }
    const body = { ok: true, message: (0, i18n_1.t)('auth.otpSent', lang) };
    if (!isConfigured) {
        // Helpful for development/testing (do not rely on this in production)
        body.debugCode = code;
    }
    return res.json(body);
});
/**
 * Handler for verifying OTP and issuing JWT tokens.
 * Shared between /verify-otp and /login endpoints.
 */
async function verifyOtpHandler(req, res) {
    const lang = req.lang || getLang(req);
    const parse = zod_1.z.object({ mobileNumber: zod_1.z.string().regex(/^09\d{9}$/), otp: zod_1.z.string().length(6) }).safeParse(req.body);
    if (!parse.success) {
        return res.status(400).json({ ok: false, message: (0, i18n_1.t)('auth.wrongCode', lang) });
    }
    const { mobileNumber, otp } = parse.data;
    const entry = otpStore.get(mobileNumber);
    if (!entry) {
        return res.status(400).json({ ok: false, message: (0, i18n_1.t)('auth.codeExpired', lang) });
    }
    if (Date.now() > entry.expiresAt) {
        otpStore.delete(mobileNumber);
        return res.status(400).json({ ok: false, message: (0, i18n_1.t)('auth.codeExpired', lang) });
    }
    if (entry.code !== otp) {
        return res.status(400).json({ ok: false, message: (0, i18n_1.t)('auth.wrongCode', lang) });
    }
    // Success: clear OTP and issue JWT tokens (persist refresh in DB)
    otpStore.delete(mobileNumber);
    const { accessToken, refreshToken } = await issueTokensForMobile(mobileNumber);
    // Minimal user object compatible with front-end expectations
    const user = {
        id: Math.floor(Math.random() * 1000000),
        username: mobileNumber,
        isAdmin: false,
        role: 'user',
        name: 'کاربر حسابداری',
        familyName: '',
        address: '',
        mobileNumber,
        permissions: {},
    };
    return res.json({ ok: true, message: (0, i18n_1.t)('auth.verified', lang), token: accessToken, refreshToken, user });
}
// Mount both endpoints to the shared handler
router.post('/verify-otp', verifyOtpHandler);
router.post('/login', verifyOtpHandler);
/**
 * POST /api/auth/refresh
 * Accepts refresh token (header `x-refresh-token` or body `refreshToken`) and returns new pair.
 */
router.post('/refresh', async (req, res) => {
    const lang = req.lang || getLang(req);
    const token = req.headers['x-refresh-token'] || req.body?.refreshToken;
    if (!token)
        return res.status(400).json({ ok: false, message: (0, i18n_1.t)('auth.invalidToken', lang) });
    const disablePersist = String(process.env.DISABLE_REFRESH_PERSISTENCE || '').toLowerCase() === 'true';
    if (disablePersist) {
        // Development path: verify JWT and issue new tokens without DB
        try {
            const decoded = jsonwebtoken_1.default.verify(token, jwtSecret);
            if (decoded?.type !== 'refresh') {
                return res.status(401).json({ ok: false, message: (0, i18n_1.t)('auth.invalidToken', lang) });
            }
            const mobile = decoded.sub;
            const { accessToken, refreshToken } = await issueTokensForMobile(mobile);
            return res.json({ ok: true, message: (0, i18n_1.t)('auth.refreshed', lang), token: accessToken, refreshToken });
        }
        catch {
            return res.status(401).json({ ok: false, message: (0, i18n_1.t)('auth.invalidToken', lang) });
        }
    }
    await (0, driver_1.ensureSchema)();
    const found = await (0, driver_1.findRefreshToken)(token);
    if (!found || found.revoked || found.expires_at.getTime() < Date.now()) {
        if (found && !found.revoked) {
            await (0, driver_1.revokeRefreshToken)(token);
        }
        return res.status(401).json({ ok: false, message: (0, i18n_1.t)('auth.invalidToken', lang) });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, jwtSecret);
        const mobile = decoded.sub;
        const { accessToken, refreshToken } = await issueTokensForMobile(mobile);
        await (0, driver_1.revokeRefreshToken)(token);
        return res.json({ ok: true, message: (0, i18n_1.t)('auth.refreshed', lang), token: accessToken, refreshToken });
    }
    catch {
        await (0, driver_1.revokeRefreshToken)(token).catch(() => { });
        return res.status(401).json({ ok: false, message: (0, i18n_1.t)('auth.invalidToken', lang) });
    }
});
/**
 * POST /api/auth/logout
 * Revokes the provided refresh token.
 */
router.post('/logout', async (req, res) => {
    const lang = req.lang || getLang(req);
    const token = req.headers['x-refresh-token'] || req.body?.refreshToken;
    if (token) {
        await (0, driver_1.ensureSchema)();
        await (0, driver_1.revokeRefreshToken)(token).catch(() => { });
    }
    return res.json({ ok: true, message: (0, i18n_1.t)('auth.loggedOut', lang) });
});
exports.default = router;
