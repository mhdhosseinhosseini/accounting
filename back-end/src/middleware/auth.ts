/**
 * Authentication middleware for verifying JWT access tokens.
 * - Reads `Authorization: Bearer <token>` header.
 * - Verifies token using `JWT_SECRET` and attaches `req.user`.
 * - Responds with localized error messages (en/fa) on failure.
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

/**
 * Extract language from request, defaulting to English.
 */
function getLang(req: Request): 'fa' | 'en' {
  const raw = (req.headers['accept-language'] || '').toString().toLowerCase();
  return raw.startsWith('fa') ? 'fa' : 'en';
}

/**
 * Localized messages used by the auth middleware.
 */
function msg(key: 'unauthorized' | 'invalidToken', lang: 'fa' | 'en'): string {
  const dict = {
    unauthorized: { fa: 'دسترسی مجاز نیست', en: 'Unauthorized' },
    invalidToken: { fa: 'توکن نامعتبر یا منقضی است', en: 'Invalid or expired token' },
  } as const;
  return dict[key][lang];
}

export interface AuthUser {
  sub: string;
  role: 'user' | 'admin';
}

const jwtSecret = process.env.JWT_SECRET || 'dev-secret';

/**
 * Require a valid JWT access token to proceed.
 * Attaches `{ mobileNumber, role }` to `req.user` when valid.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = (req.headers.authorization || '').toString();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const lang = getLang(req);

  if (!token) {
    return res.status(401).json({ ok: false, message: msg('unauthorized', lang) });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret) as AuthUser & { iat: number; exp: number };
    (req as any).user = { mobileNumber: decoded.sub, role: decoded.role };
    return next();
  } catch {
    return res.status(401).json({ ok: false, message: msg('invalidToken', lang) });
  }
}