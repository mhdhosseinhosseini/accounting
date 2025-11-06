import express, { Request, Response } from 'express';
import { t, Lang } from '../i18n';
import { requireAuth } from '../middleware/auth';
import { getPool } from '../db/pg';
import { getDb } from '../db/sqlite';

/**
 * Router for inventory transactions listing.
 * Supports Postgres and SQLite drivers.
 */
export const inventoryRouter = express.Router();

// All routes require authentication
inventoryRouter.use(requireAuth);

/** Helper to check if running with SQLite driver. */
function usingSqlite() {
  return (process.env.DB_DRIVER || '').toLowerCase() === 'sqlite';
}

/**
 * GET / - List inventory transactions.
 */
inventoryRouter.get('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    if (usingSqlite()) {
      const d = getDb();
      const items = d.prepare(`SELECT id, product_id, warehouse_id, quantity, type, date, reference FROM inventory_transactions ORDER BY date DESC`).all();
      return res.json({ items, message: t('inventory.transactions.list', lang) });
    } else {
      const p = getPool();
      const r = await p.query(`SELECT id, product_id, warehouse_id, quantity, type, date, reference FROM inventory_transactions ORDER BY date DESC`);
      return res.json({ items: r.rows, message: t('inventory.transactions.list', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});