/**
 * Accounting backend entrypoint.
 * Sets up Express server, middleware, and initial API routes per design docs.
 */
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { langMiddleware } from './middleware/lang';
import { t, Lang } from './i18n';
import { authRouter } from './routes/auth';

// Load environment variables
dotenv.config();

/**
 * Create and configure the Express application.
 */
function createApp() {
  const app = express();

  // Security and common middlewares
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(morgan('dev'));
  app.use(langMiddleware);

  /**
   * Auth routes for OTP login (mounted under /api/auth).
   */
  app.use('/api/auth', authRouter);

  /**
   * Health check endpoint.
   * Returns localized message indicating service health.
   */
  app.get('/api/health', (req: Request, res: Response) => {
    const lang: Lang = (req as any).lang || 'en';
    res.json({ ok: true, message: t('health.ok', lang) });
  });

  /**
   * List fiscal years (stub).
   * In phase 2 this will query PostgreSQL; now returns empty list.
   */
  app.get('/api/v1/fiscal-years', (req: Request, res: Response) => {
    const lang: Lang = (req as any).lang || 'en';
    res.json({ items: [], message: t('fiscalYears.list', lang) });
  });

  /**
   * Create a journal (draft).
   * Validates double-entry at the request level and returns a stub ID.
   */
  app.post('/api/v1/journals', (req: Request, res: Response) => {
    const lang: Lang = (req as any).lang || 'en';
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const totals = items.reduce(
      (acc: { debit: number; credit: number }, it: any) => {
        const d = Number(it?.debit || 0);
        const c = Number(it?.credit || 0);
        return { debit: acc.debit + d, credit: acc.credit + c };
      },
      { debit: 0, credit: 0 }
    );
    if (Math.abs(totals.debit - totals.credit) > 0.0001) {
      return res.status(400).json({ ok: false, error: t('error.unbalanced', lang) });
    }
    const id = require('crypto').randomUUID();
    res.status(201).json({ id, status: 'draft', message: t('journal.created', lang) });
  });

  /**
   * Post a journal (stub).
   * Marks the journal as posted (no persistence yet).
   */
  app.post('/api/v1/journals/:id/post', (req: Request, res: Response) => {
    const lang: Lang = (req as any).lang || 'en';
    const { id } = req.params;
    res.json({ id, status: 'posted', message: t('journal.posted', lang) });
  });

  return app;
}

/**
 * Boot the HTTP server using PORT from environment or default 4000.
 */
function startServer() {
  const app = createApp();
  const port = Number(process.env.PORT || 4100);
  app.listen(port, () => {
    console.log(`Accounting API listening on http://localhost:${port}`);
  });
}

// Start the server when executed directly
startServer();