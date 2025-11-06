import express, { Request, Response } from 'express';
import { z } from 'zod';
import { t, Lang } from '../i18n';
import { requireAuth } from '../middleware/auth';
import { getPool } from '../db/pg';
import { getDb } from '../db/sqlite';

/**
 * Router for warehouses CRUD.
 * Supports Postgres and SQLite drivers.
 */
export const warehousesRouter = express.Router();

// All routes require authentication
warehousesRouter.use(requireAuth);

/** Helper to check if running with SQLite driver. */
function usingSqlite() {
  return (process.env.DB_DRIVER || '').toLowerCase() === 'sqlite';
}

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
    if (usingSqlite()) {
      const d = getDb();
      const items = d.prepare(`SELECT id, name, code FROM warehouses ORDER BY name`).all();
      return res.json({ items, message: t('warehouses.list', lang) });
    } else {
      const p = getPool();
      const r = await p.query(`SELECT id, name, code FROM warehouses ORDER BY name`);
      return res.json({ items: r.rows, message: t('warehouses.list', lang) });
    }
  } catch (e) {
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
    if (usingSqlite()) {
      const d = getDb();
      const dup = d.prepare(`SELECT id FROM warehouses WHERE code = ?`).get(code);
      if (dup) return res.status(409).json({ ok: false, error: t('warehouses.duplicateCode', lang) });
      d.prepare(`INSERT INTO warehouses (id, name, code) VALUES (?, ?, ?)`).run(id, name, code);
      return res.status(201).json({ id, message: t('warehouses.created', lang) });
    } else {
      const p = getPool();
      const dup = await p.query(`SELECT id FROM warehouses WHERE code = $1`, [code]);
      if ((dup.rowCount || 0) > 0) return res.status(409).json({ ok: false, error: t('warehouses.duplicateCode', lang) });
      await p.query(`INSERT INTO warehouses (id, name, code) VALUES ($1, $2, $3)`, [id, name, code]);
      return res.status(201).json({ id, message: t('warehouses.created', lang) });
    }
  } catch (e) {
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
    if (usingSqlite()) {
      const d = getDb();
      const exist = d.prepare(`SELECT id FROM warehouses WHERE id = ?`).get(id);
      if (!exist) return res.status(404).json({ ok: false, error: t('warehouses.notFound', lang) });
      if (code) {
        const dup = d.prepare(`SELECT id FROM warehouses WHERE code = ? AND id <> ?`).get(code, id);
        if (dup) return res.status(409).json({ ok: false, error: t('warehouses.duplicateCode', lang) });
      }
      d.prepare(`UPDATE warehouses SET name = COALESCE(?, name), code = COALESCE(?, code) WHERE id = ?`).run(name ?? null, code ?? null, id);
      return res.json({ id, message: t('warehouses.updated', lang) });
    } else {
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
    }
  } catch (e) {
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
    if (usingSqlite()) {
      const d = getDb();
      const r = d.prepare(`DELETE FROM warehouses WHERE id = ?`).run(id);
      if (r.changes === 0) return res.status(404).json({ ok: false, error: t('warehouses.notFound', lang) });
      return res.json({ id, message: t('warehouses.deleted', lang) });
    } else {
      const p = getPool();
      const r = await p.query(`DELETE FROM warehouses WHERE id = $1`, [id]);
      if ((r.rowCount || 0) === 0) return res.status(404).json({ ok: false, error: t('warehouses.notFound', lang) });
      return res.json({ id, message: t('warehouses.deleted', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});