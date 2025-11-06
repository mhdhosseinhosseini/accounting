import express, { Request, Response } from 'express';
import { z } from 'zod';
import { t, Lang } from '../i18n';
import { requireAuth } from '../middleware/auth';
import { getPool } from '../db/pg';
import { getDb } from '../db/sqlite';

/**
 * Router for parties CRUD.
 * Supports Postgres and SQLite drivers.
 */
export const partiesRouter = express.Router();

// All routes require authentication
partiesRouter.use(requireAuth);

/** Helper to check if running with SQLite driver. */
function usingSqlite() {
  return (process.env.DB_DRIVER || '').toLowerCase() === 'sqlite';
}

/** Zod schema for party creation. */
const partyCreateSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  mobile: z.string().optional(),
  address: z.string().optional(),
});

/** Zod schema for party update. */
const partyUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().optional(),
  mobile: z.string().optional(),
  address: z.string().optional(),
});

/**
 * GET / - List parties.
 */
partiesRouter.get('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    if (usingSqlite()) {
      const d = getDb();
      const items = d.prepare(`SELECT id, name, code, mobile, address FROM parties ORDER BY name`).all();
      return res.json({ items, message: t('parties.list', lang) });
    } else {
      const p = getPool();
      const r = await p.query(`SELECT id, name, code, mobile, address FROM parties ORDER BY name`);
      return res.json({ items: r.rows, message: t('parties.list', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST / - Create a party.
 */
partiesRouter.post('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const parse = partyCreateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { name, code, mobile, address } = parse.data;
  const id = require('crypto').randomUUID();
  try {
    if (usingSqlite()) {
      const d = getDb();
      if (code) {
        const dup = d.prepare(`SELECT id FROM parties WHERE code = ?`).get(code);
        if (dup) return res.status(409).json({ ok: false, error: t('parties.duplicateCode', lang) });
      }
      d.prepare(`INSERT INTO parties (id, name, code, mobile, address) VALUES (?, ?, ?, ?, ?)`).run(id, name, code ?? null, mobile ?? null, address ?? null);
      return res.status(201).json({ id, message: t('parties.created', lang) });
    } else {
      const p = getPool();
      if (code) {
        const dup = await p.query(`SELECT id FROM parties WHERE code = $1`, [code]);
        if ((dup.rowCount || 0) > 0) return res.status(409).json({ ok: false, error: t('parties.duplicateCode', lang) });
      }
      await p.query(`INSERT INTO parties (id, name, code, mobile, address) VALUES ($1, $2, $3, $4, $5)`, [id, name, code ?? null, mobile ?? null, address ?? null]);
      return res.status(201).json({ id, message: t('parties.created', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * PATCH /:id - Update a party.
 */
partiesRouter.patch('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  const parse = partyUpdateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { name, code, mobile, address } = parse.data;
  try {
    if (usingSqlite()) {
      const d = getDb();
      const exist = d.prepare(`SELECT id FROM parties WHERE id = ?`).get(id);
      if (!exist) return res.status(404).json({ ok: false, error: t('parties.notFound', lang) });
      if (code) {
        const dup = d.prepare(`SELECT id FROM parties WHERE code = ? AND id <> ?`).get(code, id);
        if (dup) return res.status(409).json({ ok: false, error: t('parties.duplicateCode', lang) });
      }
      d.prepare(`UPDATE parties SET name = COALESCE(?, name), code = COALESCE(?, code), mobile = COALESCE(?, mobile), address = COALESCE(?, address) WHERE id = ?`).run(name ?? null, code ?? null, mobile ?? null, address ?? null, id);
      return res.json({ id, message: t('parties.updated', lang) });
    } else {
      const p = getPool();
      const exist = await p.query(`SELECT id FROM parties WHERE id = $1`, [id]);
      if (exist.rowCount === 0) return res.status(404).json({ ok: false, error: t('parties.notFound', lang) });
      if (code) {
        const dup = await p.query(`SELECT id FROM parties WHERE code = $1 AND id <> $2`, [code, id]);
        if ((dup.rowCount || 0) > 0) return res.status(409).json({ ok: false, error: t('parties.duplicateCode', lang) });
      }
      const r = await p.query(`UPDATE parties SET name = COALESCE($1, name), code = COALESCE($2, code), mobile = COALESCE($3, mobile), address = COALESCE($4, address) WHERE id = $5 RETURNING id`, [name ?? null, code ?? null, mobile ?? null, address ?? null, id]);
      if (r.rowCount === 0) return res.status(404).json({ ok: false, error: t('parties.notFound', lang) });
      return res.json({ id, message: t('parties.updated', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * DELETE /:id - Delete a party.
 */
partiesRouter.delete('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    if (usingSqlite()) {
      const d = getDb();
      const r = d.prepare(`DELETE FROM parties WHERE id = ?`).run(id);
      if (r.changes === 0) return res.status(404).json({ ok: false, error: t('parties.notFound', lang) });
      return res.json({ id, message: t('parties.deleted', lang) });
    } else {
      const p = getPool();
      const r = await p.query(`DELETE FROM parties WHERE id = $1`, [id]);
      if ((r.rowCount || 0) === 0) return res.status(404).json({ ok: false, error: t('parties.notFound', lang) });
      return res.json({ id, message: t('parties.deleted', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});