import express, { Request, Response } from 'express';
import { z } from 'zod';
import { t, Lang } from '../i18n';
import { requireAuth } from '../middleware/auth';
import { getPool } from '../db/pg';


/**
 * Router for warehouses CRUD.
 * Postgres-only implementation.
 */
export const warehousesRouter = express.Router();

// All routes require authentication
warehousesRouter.use(requireAuth);



/** Zod schema for warehouse creation. */
const warehouseCreateSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
});

/** Zod schema for warehouse update. */
const warehouseUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
});

/**
 * GET / - List warehouses.
 */
warehousesRouter.get('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    const p = getPool();
    const r = await p.query(`SELECT id, name, code FROM warehouses ORDER BY name`);
    return res.json({ items: r.rows, message: t('warehouses.list', lang) });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST / - Create a warehouse.
 */
warehousesRouter.post('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const parse = warehouseCreateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { name, code } = parse.data;
  const id = require('crypto').randomUUID();
  try {
    const p = getPool();
    const dup = await p.query(`SELECT id FROM warehouses WHERE code = $1`, [code]);
    if ((dup.rowCount || 0) > 0) return res.status(409).json({ ok: false, error: t('warehouses.duplicateCode', lang) });
    await p.query(`INSERT INTO warehouses (id, name, code) VALUES ($1, $2, $3)`, [id, name, code]);
    return res.status(201).json({ id, message: t('warehouses.created', lang) });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * PATCH /:id - Update a warehouse.
 */
warehousesRouter.patch('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  const parse = warehouseUpdateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { name, code } = parse.data;
  try {
    const p = getPool();
    const exist = await p.query(`SELECT id FROM warehouses WHERE id = $1`, [id]);
    if (exist.rowCount === 0) return res.status(404).json({ ok: false, error: t('warehouses.notFound', lang) });
    if (code) {
      const dup = await p.query(`SELECT id FROM warehouses WHERE code = $1 AND id <> $2`, [code, id]);
      if ((dup.rowCount || 0) > 0) return res.status(409).json({ ok: false, error: t('warehouses.duplicateCode', lang) });
    }
    const r = await p.query(`UPDATE warehouses SET name = COALESCE($1, name), code = COALESCE($2, code) WHERE id = $3 RETURNING id`, [name ?? null, code ?? null, id]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: t('warehouses.notFound', lang) });
    return res.json({ id, message: t('warehouses.updated', lang) });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * DELETE /:id - Delete a warehouse.
 */
warehousesRouter.delete('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    const p = getPool();
    const r = await p.query(`DELETE FROM warehouses WHERE id = $1`, [id]);
    if ((r.rowCount || 0) === 0) return res.status(404).json({ ok: false, error: t('warehouses.notFound', lang) });
    return res.json({ id, message: t('warehouses.deleted', lang) });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});