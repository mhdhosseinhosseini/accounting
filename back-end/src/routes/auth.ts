/**
 * Auth routes implementing OTP request and verification for Accounting backend.
 * Follows the server project's approach, simplified without DB.
 * - POST /request-otp: validates mobile, generates 6-digit OTP, stores in memory, sends SMS.
 * - POST /verify-otp: validates OTP, returns a token and minimal user object.
 * Notes:
 * - Accept-Language header is used to localize responses (fa/en).
 * - In-memory store resets on server restart; suitable for development environments.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { smsService } from '../services/smsService';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { ensureSchema, upsertUserByMobile, storeRefreshToken, findRefreshToken, revokeRefreshToken } from '../db/driver';
import { t, Lang } from '../i18n';

// In-memory OTP store: mobile -> { code, expiresAt }
const otpStore = new Map<string, { code: string; expiresAt: number }>();
const router = Router();

// OTP request rate limiter using env-configured max per minute
/**
 * Protect OTP endpoint from abuse with a simple rate limiter per IP.
 */
const otpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_REQUEST_OTP_PER_MIN ?? '5', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: (req: Request) => ({ ok: false, message: t('auth.tooManyRequests', getLang(req)) }),
});

/**
 * Additional per-mobile rate limit to reduce OTP abuse.
 * Window: 10 minutes; Limit configurable via RATE_LIMIT_REQUEST_OTP_PER_MOBILE_PER_10M (default 5).
 */
const mobileWindowMs = 10 * 60 * 1000;
const mobileMax = parseInt(process.env.RATE_LIMIT_REQUEST_OTP_PER_MOBILE_PER_10M ?? '5', 10);
const mobileLimits = new Map<string, { count: number; resetAt: number }>();

// JWT configuration and refresh token store
/**
 * Token payload shape used for access tokens.
 */
type TokenPayload = { sub: string; role: 'user' | 'admin' };

const jwtSecret = process.env.JWT_SECRET || 'dev-secret';
const accessExpiresIn = process.env.JWT_EXPIRES_IN || '15m';
const refreshExpiresIn = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
// Removed in-memory refresh store; now persisted in DB via Prisma.

/**
 * Parse a duration string like "15m", "7d", or seconds to numeric seconds.
 */
function parseExpires(value: string): number {
  const m = value.match(/^(\d+)([smhd])$/);
  if (!m) return parseInt(value, 10);
  const num = parseInt(m[1], 10);
  const unit = m[2];
  const unitMap: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return num * (unitMap[unit] || 1);
}

/**
 * Issue tokens and persist refresh token using direct SQL (pg/sqlite via driver).
 * Ensures schema, upserts user by mobile, stores refresh token with expiry.
 */
async function issueTokensForMobile(mobileNumber: string) {
  await ensureSchema();
  const user = await upsertUserByMobile(mobileNumber);

  const payload: TokenPayload = { sub: mobileNumber, role: 'user' };
  const accessToken = jwt.sign(payload, jwtSecret, { expiresIn: parseExpires(accessExpiresIn) });
  const refreshToken = jwt.sign({ sub: mobileNumber, type: 'refresh' }, jwtSecret, { expiresIn: parseExpires(refreshExpiresIn) });

  const decoded: any = jwt.decode(refreshToken);
  const expMs = decoded?.exp ? decoded.exp * 1000 : Date.now() + 7 * 24 * 60 * 60 * 1000;
  await storeRefreshToken(refreshToken, user.id, expMs);

  return { accessToken, refreshToken };
}

/**
 * Helper: get language from Accept-Language header.
 */
function getLang(req: Request): Lang {
  const raw = (req.headers['accept-language'] || '').toString().toLowerCase();
  if (raw.startsWith('fa')) return 'fa';
  return 'en';
}

/**
 * Helper: localized messages.
 */
function msg(key: string, lang: 'fa' | 'en'): string {
  const dict: Record<string, { fa: string; en: string }> = {
    invalidMobile: {
      fa: 'شماره موبایل نامعتبر است',
      en: 'Invalid mobile number',
    },
    otpSent: {
      fa: 'کد تایید ارسال شد',
      en: 'Verification code sent',
    },
    tooManyRequests: {
      fa: 'لطفاً کمی صبر کنید و دوباره تلاش کنید',
      en: 'Please wait a bit and try again',
    },
    codeExpired: {
      fa: 'کد تایید منقضی شده است',
      en: 'Verification code expired',
    },
    wrongCode: {
      fa: 'کد تایید اشتباه است',
      en: 'Incorrect verification code',
    },
    verified: {
      fa: 'ورود با موفقیت انجام شد',
      en: 'Login successful',
    },
    invalidToken: {
      fa: 'توکن نامعتبر یا منقضی است',
      en: 'Invalid or expired token',
    },
    refreshed: {
      fa: 'توکن با موفقیت به‌روزرسانی شد',
      en: 'Token refreshed successfully',
    },
    loggedOut: {
      fa: 'خروج با موفقیت انجام شد',
      en: 'Logged out successfully',
    },
  };
  return (dict[key] || { fa: key, en: key })[lang];
}

/**
 * Zod schemas for inputs.
 */
const RequestOtpSchema = z.object({ mobileNumber: z.string().regex(/^09\d{9}$/) });
const VerifyOtpSchema = z.object({ mobileNumber: z.string().regex(/^09\d{9}$/), otp: z.string().length(6) });

/**
 * POST /api/auth/request-otp
 * Generates a 6-digit OTP for the provided mobile number,
 * persists it in the in-memory store with a 2-minute expiry,
 * and attempts to send via Magfa SMS if credentials are configured.
 * - In production (SMS configured): returns 500 on SMS failure.
 * - In development (no SMS configured): logs failure and returns ok with debugCode.
 * Responses are localized based on the Accept-Language header (fa/en).
 */
router.post('/request-otp', otpLimiter, async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || getLang(req);
  const parse = z.object({ mobileNumber: z.string().regex(/^09\d{9}$/) }).safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ ok: false, message: t('auth.invalidMobile', lang) });
  }
  const { mobileNumber } = parse.data;

  // Per-mobile limiter
  const now = Date.now();
  const mEntry = mobileLimits.get(mobileNumber);
  if (!mEntry || now > mEntry.resetAt) {
    mobileLimits.set(mobileNumber, { count: 1, resetAt: now + mobileWindowMs });
  } else if (mEntry.count >= mobileMax) {
    return res.status(429).json({ ok: false, message: t('auth.tooManyRequests', lang) });
  } else {
    mEntry.count += 1;
  }

  // Determine if SMS provider is configured (production behavior)
  const isConfigured = !!(
    process.env.MAGFA_USERNAME && process.env.MAGFA_PASSWORD && process.env.MAGFA_DOMAIN
  );

  // Generate a 6-digit OTP and store with 2 minutes expiry
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 2 * 60 * 1000; // 2 minutes
  otpStore.set(mobileNumber, { code, expiresAt });
  console.log(`Generated OTP for ${mobileNumber}: ${code}`);

  const result = await smsService.sendOtp(mobileNumber, code);
  if (!result.success) {
    if (isConfigured) {
      // In production, fail the request so user isn't stuck without SMS
      return res.status(500).json({ ok: false, message: result.error || t('auth.tooManyRequests', lang) });
    }
    // Dev fallback: log but continue
    console.error('SMS send failed (dev fallback):', result.error);
  }

  const body: any = { ok: true, message: t('auth.otpSent', lang) };
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
async function verifyOtpHandler(req: Request, res: Response) {
  const lang: Lang = (req as any).lang || getLang(req);
  const parse = z.object({ mobileNumber: z.string().regex(/^09\d{9}$/), otp: z.string().length(6) }).safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ ok: false, message: t('auth.wrongCode', lang) });
  }
  const { mobileNumber, otp } = parse.data;

  const entry = otpStore.get(mobileNumber);
  if (!entry) {
    return res.status(400).json({ ok: false, message: t('auth.codeExpired', lang) });
  }
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(mobileNumber);
    return res.status(400).json({ ok: false, message: t('auth.codeExpired', lang) });
  }
  if (entry.code !== otp) {
    return res.status(400).json({ ok: false, message: t('auth.wrongCode', lang) });
  }

  // Success: clear OTP and issue JWT tokens (persist refresh in DB)
  otpStore.delete(mobileNumber);
  const { accessToken, refreshToken } = await issueTokensForMobile(mobileNumber);

  // Minimal user object compatible with front-end expectations
  const user = {
    id: Math.floor(Math.random() * 1000000),
    username: mobileNumber,
    isAdmin: false,
    role: 'user' as const,
    name: 'کاربر حسابداری',
    familyName: '',
    address: '',
    mobileNumber,
    permissions: {},
  };

  return res.json({ ok: true, message: t('auth.verified', lang), token: accessToken, refreshToken, user });
}

// Mount both endpoints to the shared handler
router.post('/verify-otp', verifyOtpHandler);
router.post('/login', verifyOtpHandler);

/**
 * POST /api/auth/refresh
 * Accepts refresh token (header `x-refresh-token` or body `refreshToken`) and returns new pair.
 */
router.post('/refresh', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || getLang(req);
  const token = (req.headers['x-refresh-token'] as string) || (req.body?.refreshToken as string);
  if (!token) return res.status(400).json({ ok: false, message: t('auth.invalidToken', lang) });

  await ensureSchema();
  const found = await findRefreshToken(token);
  if (!found || found.revoked || found.expires_at.getTime() < Date.now()) {
    if (found && !found.revoked) {
      await revokeRefreshToken(token);
    }
    return res.status(401).json({ ok: false, message: t('auth.invalidToken', lang) });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret) as any;
    const mobile = decoded.sub as string;
    const { accessToken, refreshToken } = await issueTokensForMobile(mobile);
    await revokeRefreshToken(token);
    return res.json({ ok: true, message: t('auth.refreshed', lang), token: accessToken, refreshToken });
  } catch {
    await revokeRefreshToken(token).catch(() => {});
    return res.status(401).json({ ok: false, message: t('auth.invalidToken', lang) });
  }
});

/**
 * POST /api/auth/logout
 * Revokes the provided refresh token.
 */
router.post('/logout', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || getLang(req);
  const token = (req.headers['x-refresh-token'] as string) || (req.body?.refreshToken as string);
  if (token) {
    await ensureSchema();
    await revokeRefreshToken(token).catch(() => {});
  }
  return res.json({ ok: true, message: t('auth.loggedOut', lang) });
});

export default router;
export { router as authRouter };