import express, { Request, Response } from 'express';
import { z } from 'zod';
import { t, Lang } from '../i18n';
import { requireAuth } from '../middleware/auth';
import { getPool } from '../db/pg';
import { getDb } from '../db/sqlite';

/**
 * Router for products CRUD.
 * Supports Postgres and SQLite.
 */
export const productsRouter = express.Router();

// All routes require authentication
productsRouter.use(requireAuth);

/** Helper to check if running with SQLite driver. */
function usingSqlite() {
  return (process.env.DB_DRIVER || '').toLowerCase() === 'sqlite';
}

/** Zod schema for product creation. */
const productCreateSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional(),
  price: z.number().min(0),
});

/** Zod schema for product update. */
const productUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  sku: z.string().optional(),
  price: z.number().min(0).optional(),
});

/**
 * GET / - List products.
 */
productsRouter.get('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    if (usingSqlite()) {
      const d = getDb();
      const items = d.prepare(`SELECT id, name, sku, price FROM products ORDER BY name`).all();
      return res.json({ items, message: t('products.list', lang) });
    } else {
      const p = getPool();
      const r = await p.query(`SELECT id, name, sku, price FROM products ORDER BY name`);
      return res.json({ items: r.rows, message: t('products.list', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST / - Create a product.
 */
productsRouter.post('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const parse = productCreateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { name, sku, price } = parse.data;
  const id = require('crypto').randomUUID();
  try {
    if (usingSqlite()) {
      const d = getDb();
      if (sku) {
        const dup = d.prepare(`SELECT id FROM products WHERE sku = ?`).get(sku);
        if (dup) return res.status(409).json({ ok: false, error: t('products.duplicateSku', lang) });
      }
      d.prepare(`INSERT INTO products (id, name, sku, price) VALUES (?, ?, ?, ?)`).run(id, name, sku ?? null, price);
      return res.status(201).json({ id, message: t('products.created', lang) });
    } else {
      const p = getPool();
      if (sku) {
        const dup = await p.query(`SELECT id FROM products WHERE sku = $1`, [sku]);
        if ((dup.rowCount || 0) > 0) return res.status(409).json({ ok: false, error: t('products.duplicateSku', lang) });
      }
      await p.query(`INSERT INTO products (id, name, sku, price) VALUES ($1, $2, $3, $4)`, [id, name, sku ?? null, price]);
      return res.status(201).json({ id, message: t('products.created', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * PATCH /:id - Update a product.
 */
productsRouter.patch('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  const parse = productUpdateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { name, sku, price } = parse.data;
  try {
    if (usingSqlite()) {
      const d = getDb();
      const exist = d.prepare(`SELECT id FROM products WHERE id = ?`).get(id);
      if (!exist) return res.status(404).json({ ok: false, error: t('products.notFound', lang) });
      if (sku) {
        const dup = d.prepare(`SELECT id FROM products WHERE sku = ? AND id <> ?`).get(sku, id);
        if (dup) return res.status(409).json({ ok: false, error: t('products.duplicateSku', lang) });
      }
      d.prepare(`UPDATE products SET name = COALESCE(?, name), sku = COALESCE(?, sku), price = COALESCE(?, price) WHERE id = ?`).run(name ?? null, sku ?? null, price ?? null, id);
      return res.json({ id, message: t('products.updated', lang) });
    } else {
      const p = getPool();
      const exist = await p.query(`SELECT id FROM products WHERE id = $1`, [id]);
      if (exist.rowCount === 0) return res.status(404).json({ ok: false, error: t('products.notFound', lang) });
      if (sku) {
        const dup = await p.query(`SELECT id FROM products WHERE sku = $1 AND id <> $2`, [sku, id]);
        if ((dup.rowCount || 0) > 0) return res.status(409).json({ ok: false, error: t('products.duplicateSku', lang) });
      }
      const r = await p.query(`UPDATE products SET name = COALESCE($1, name), sku = COALESCE($2, sku), price = COALESCE($3, price) WHERE id = $4 RETURNING id`, [name ?? null, sku ?? null, price ?? null, id]);
      if (r.rowCount === 0) return res.status(404).json({ ok: false, error: t('products.notFound', lang) });
      return res.json({ id, message: t('products.updated', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * DELETE /:id - Delete a product.
 */
productsRouter.delete('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    if (usingSqlite()) {
      const d = getDb();
      const r = d.prepare(`DELETE FROM products WHERE id = ?`).run(id);
      if (r.changes === 0) return res.status(404).json({ ok: false, error: t('products.notFound', lang) });
      return res.json({ id, message: t('products.deleted', lang) });
    } else {
      const p = getPool();
      const r = await p.query(`DELETE FROM products WHERE id = $1`, [id]);
      if ((r.rowCount || 0) === 0) return res.status(404).json({ ok: false, error: t('products.notFound', lang) });
      return res.json({ id, message: t('products.deleted', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});