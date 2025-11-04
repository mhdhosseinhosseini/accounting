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
import { randomBytes } from 'crypto';

// In-memory OTP store: mobile -> { code, expiresAt }
const otpStore = new Map<string, { code: string; expiresAt: number }>();
const router = Router();

/**
 * Helper: get language from Accept-Language header.
 */
function getLang(req: Request): 'fa' | 'en' {
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
router.post('/request-otp', async (req: Request, res: Response) => {
  const lang = getLang(req);
  const parse = RequestOtpSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ ok: false, message: msg('invalidMobile', lang) });
  }
  const { mobileNumber } = parse.data;

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
      return res.status(500).json({ ok: false, message: result.error || msg('tooManyRequests', lang) });
    }
    // Dev fallback: log but continue
    console.error('SMS send failed (dev fallback):', result.error);
  }

  const body: any = { ok: true, message: msg('otpSent', lang) };
  if (!isConfigured) {
    // Helpful for development/testing (do not rely on this in production)
    body.debugCode = code;
  }
  return res.json(body);
});

/**
 * POST /verify-otp
 * - Validates mobile and OTP.
 * - Checks expiry and correctness.
 * - Returns a token and minimal user object compatible with front-end.
 */
router.post('/verify-otp', async (req: Request, res: Response) => {
  const lang = getLang(req);
  const parse = VerifyOtpSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ ok: false, message: msg('wrongCode', lang) });
  }
  const { mobileNumber, otp } = parse.data;

  const entry = otpStore.get(mobileNumber);
  if (!entry) {
    return res.status(400).json({ ok: false, message: msg('codeExpired', lang) });
  }
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(mobileNumber);
    return res.status(400).json({ ok: false, message: msg('codeExpired', lang) });
  }
  if (entry.code !== otp) {
    return res.status(400).json({ ok: false, message: msg('wrongCode', lang) });
  }

  // Success: clear OTP and issue a token (random for now)
  otpStore.delete(mobileNumber);
  const token = randomBytes(24).toString('hex');

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

  return res.json({ ok: true, message: msg('verified', lang), token, user });
});

export default router;
export { router as authRouter };