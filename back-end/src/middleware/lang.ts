/**
 * Middleware to derive request language from Accept-Language.
 * Defaults to English; supports 'fa' for Farsi.
 */
import { Request, Response, NextFunction } from 'express';
import type { Lang } from '../i18n';

export function langMiddleware(req: Request, _res: Response, next: NextFunction) {
  const header = (req.headers['accept-language'] || '').toString().toLowerCase();
  let selected: Lang = 'en';
  if (header.startsWith('fa')) selected = 'fa';
  // Attach selected language to request for downstream handlers
  (req as any).lang = selected;
  next();
}