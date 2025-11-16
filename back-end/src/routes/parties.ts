import express, { Request, Response } from 'express';
import { z } from 'zod';
import { t, Lang } from '../i18n';
import { requireAuth } from '../middleware/auth';
import { getPool } from '../db/pg';


/**
 * Router for parties CRUD.
 * Postgres-only implementation.
 */
export const partiesRouter = express.Router();

// All routes require authentication
partiesRouter.use(requireAuth);



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
    // Postgres-only list implementation
    const p = getPool();
    const r = await p.query(`SELECT id, name, code, mobile, address FROM parties ORDER BY name`);
    return res.json({ items: r.rows, message: t('parties.list', lang) });
  } catch {
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
    // Postgres-only create implementation
    const p = getPool();
    if (code) {
      const dup = await p.query(`SELECT id FROM parties WHERE code = $1`, [code]);
      if ((dup.rowCount || 0) > 0) return res.status(409).json({ ok: false, error: t('parties.duplicateCode', lang) });
    }
    await p.query(`INSERT INTO parties (id, name, code, mobile, address) VALUES ($1, $2, $3, $4, $5)`, [id, name, code ?? null, mobile ?? null, address ?? null]);
    return res.status(201).json({ id, message: t('parties.created', lang) });
  } catch {
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
    // Postgres-only update implementation
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
  } catch {
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
    // Postgres-only delete implementation
    const p = getPool();
    const r = await p.query(`DELETE FROM parties WHERE id = $1`, [id]);
    if ((r.rowCount || 0) === 0) return res.status(404).json({ ok: false, error: t('parties.notFound', lang) });
    return res.json({ id, message: t('parties.deleted', lang) });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});