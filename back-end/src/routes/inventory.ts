import express, { Request, Response } from 'express';
import { t, Lang } from '../i18n';
import { requireAuth } from '../middleware/auth';
import { getPool } from '../db/pg';

/**
 * Router for inventory transactions listing.
 * Postgres-only implementation.
 */
export const inventoryRouter = express.Router();

// All routes require authentication
inventoryRouter.use(requireAuth);

/**
 * GET / - List inventory transactions (Postgres-only).
 */
inventoryRouter.get('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    const p = getPool();
    const r = await p.query(
      `SELECT id, product_id, warehouse_id, quantity, type, date, reference
       FROM inventory_transactions
       ORDER BY date DESC`
    );
    return res.json({ items: r.rows, message: t('inventory.transactions.list', lang) });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});