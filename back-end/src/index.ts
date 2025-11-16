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
import { fiscalYearsRouter } from './routes/fiscalYears';
// import { accountsRouter } from './routes/accounts';
import { journalsRouter } from './routes/journals';
import { productsRouter } from './routes/products';
import { partiesRouter } from './routes/parties';
import { warehousesRouter } from './routes/warehouses';
import { invoicesRouter } from './routes/invoices';
import { inventoryRouter } from './routes/inventory';
import { requireAuth } from './middleware/auth';
import { ensureSchema, pingDb } from './db/driver';
import swaggerUi from 'swagger-ui-express';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { reportsRouter } from './routes/reports';
import { detailsRouter } from './routes/details';
import codesRouter from './routes/codes';
import { detailLevelsRouter } from './routes/detailLevels';

// Load environment variables
dotenv.config();

// Parsed OpenAPI spec cache for debugging Swagger UI
let openapiSpec: any | null = null;

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
   * Current user endpoint using JWT access token.
   */
  app.get('/api/me', requireAuth, (req: Request, res: Response) => {
    const lang: Lang = (req as any).lang || 'en';
    const user = (req as any).user || null;
    res.json({ ok: true, user });
  });

  /**
   * Health check endpoint.
   * Returns localized message and database connectivity status.
   */
  app.get('/api/health', async (req: Request, res: Response) => {
    const lang: Lang = (req as any).lang || 'en';
    const ping = await pingDb().catch(() => ({ ok: false, driver: 'postgres' as const }));
    res.json({ ok: true, message: t('health.ok', lang), db: ping });
  });

  /**
   * Swagger UI: serves OpenAPI spec from openapi.yaml at /api/docs.
   * Attempts multiple paths to locate the YAML file both in dev (src) and build (dist).
   * Persian (Farsi) labels in the spec are preserved via the YAML content.
   */
  try {
    const candidates = [
      path.resolve(__dirname, '../openapi.yaml'),
      path.resolve(__dirname, '../../openapi.yaml'),
      path.resolve(process.cwd(), 'openapi.yaml'),
    ];
    let spec: any | null = null;
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const file = fs.readFileSync(p, 'utf8');
        spec = YAML.parse(file);
        openapiSpec = spec;
        break;
      }
    }
    if (spec) {
      app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, { explorer: true }));
    }
  } catch (e) {
    console.error('Failed to mount Swagger UI:', e);
  }

  /**
   * Expose the parsed OpenAPI spec as JSON for debugging.
   * Route: GET /api/openapi.json
   * Returns the currently loaded OpenAPI document so we can verify 'paths' entries.
   */
  app.get('/api/openapi.json', (req: Request, res: Response) => {
    res.json(openapiSpec || {});
  });

  /**
   * Phase 2 routers: fiscal years, accounts, journals, products, and parties
   */
  app.use('/api/v1/fiscal-years', fiscalYearsRouter);
  // app.use('/api/v1/accounts', accountsRouter); // accounts removed
  app.use('/api/v1/journals', journalsRouter);
  app.use('/api/v1/products', productsRouter);
  app.use('/api/v1/parties', partiesRouter);
  app.use('/api/v1/warehouses', warehousesRouter);
  app.use('/api/v1/invoices', invoicesRouter);
  app.use('/api/v1/inventory', inventoryRouter);
  app.use('/api/v1/reports', reportsRouter);
  app.use('/api/v1/details', detailsRouter);
  app.use('/api/v1/codes', codesRouter);
  app.use('/api/v1/detail-levels', detailLevelsRouter);

  // Journals endpoints are handled by journalsRouter mounted above.

  return app;
}

/**
 * Boot the HTTP server using PORT from environment or default 4000.
 * Ensures database schema before listening to requests.
 */
function startServer() {
  const app = createApp();
  const port = Number(process.env.PORT || 4100);
  ensureSchema()
    .catch((e) => {
      console.error('Failed to ensure schema:', e);
    })
    .finally(() => {
      app.listen(port, () => {
        console.log(`Accounting API listening on http://localhost:${port}`);
      });
    });
}

// Export createApp for tests
export { createApp };

// Start the server unless running in test mode
if (process.env.NODE_ENV !== 'test') {
  startServer();
}