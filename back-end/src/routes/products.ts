import express, { Request, Response } from 'express';
import { z } from 'zod';
import { t, Lang } from '../i18n';
import { requireAuth } from '../middleware/auth';
import { getPool } from '../db/pg';

/**
 * Router for products CRUD.
 * Postgres-only implementation.
 */
export const productsRouter = express.Router();

// All routes require authentication
productsRouter.use(requireAuth);

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
    // Postgres-only list implementation
    const p = getPool();
    const r = await p.query(`SELECT id, name, sku, price FROM products ORDER BY name`);
    return res.json({ items: r.rows, message: t('products.list', lang) });
  } catch {
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
    // Postgres-only create implementation
    const p = getPool();
    if (sku) {
      const dup = await p.query(`SELECT id FROM products WHERE sku = $1`, [sku]);
      if ((dup.rowCount || 0) > 0) return res.status(409).json({ ok: false, error: t('products.duplicateSku', lang) });
    }
    await p.query(`INSERT INTO products (id, name, sku, price) VALUES ($1, $2, $3, $4)`, [id, name, sku ?? null, price]);
    return res.status(201).json({ id, message: t('products.created', lang) });
  } catch {
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
    // Postgres-only update implementation
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
  } catch {
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
    // Postgres-only delete implementation
    const p = getPool();
    const r = await p.query(`DELETE FROM products WHERE id = $1`, [id]);
    if ((r.rowCount || 0) === 0) return res.status(404).json({ ok: false, error: t('products.notFound', lang) });
    return res.json({ id, message: t('products.deleted', lang) });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});