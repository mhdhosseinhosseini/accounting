import express, { Request, Response } from 'express';
import { z } from 'zod';
import { t, Lang } from '../i18n';
import { requireAuth } from '../middleware/auth';
import { getPool } from '../db/pg';
import { getDb } from '../db/sqlite';

/**
 * Router for accounts CRUD and tree retrieval.
 * Works with Postgres and SQLite based on DB_DRIVER.
 */
export const accountsRouter = express.Router();

// All routes require authentication
accountsRouter.use(requireAuth);

/** Account type enum for validation. */
const accountTypeEnum = z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']);

/** Create input schema. */
const accountCreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: accountTypeEnum,
  parent_id: z.string().uuid().optional().nullable(),
});

/** Update input schema. */
const accountUpdateSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  type: accountTypeEnum.optional(),
  parent_id: z.string().uuid().optional().nullable(),
});

function usingSqlite() {
  return (process.env.DB_DRIVER || '').toLowerCase() === 'sqlite';
}

/**
 * GET / - List all accounts.
 */
accountsRouter.get('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    if (usingSqlite()) {
      const d = getDb();
      const items = d.prepare(`SELECT id, code, name, parent_id, level, type FROM accounts ORDER BY code`).all();
      return res.json({ items, message: t('accounts.list', lang) });
    } else {
      const p = getPool();
      const r = await p.query(`SELECT id, code, name, parent_id, level, type FROM accounts ORDER BY code`);
      return res.json({ items: r.rows, message: t('accounts.list', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST / - Create an account.
 */
accountsRouter.post('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const parse = accountCreateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { code, name, type, parent_id } = parse.data;
  const id = require('crypto').randomUUID();
  try {
    if (usingSqlite()) {
      const d = getDb();
      const dup = d.prepare(`SELECT id FROM accounts WHERE code = ?`).get(code);
      if (dup) return res.status(409).json({ ok: false, error: t('accounts.duplicateCode', lang) });
      const level = parent_id ? ((d.prepare(`SELECT level FROM accounts WHERE id = ?`).get(parent_id) as any)?.level ?? 0) + 1 : 0;
      d.prepare(`INSERT INTO accounts (id, code, name, parent_id, level, type) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, code, name, parent_id ?? null, level, type);
      return res.status(201).json({ id, message: t('accounts.created', lang) });
    } else {
      const p = getPool();
      const dup = await p.query(`SELECT id FROM accounts WHERE code = $1`, [code]);
      if ((dup.rowCount || 0) > 0) return res.status(409).json({ ok: false, error: t('accounts.duplicateCode', lang) });
      const parentLevelRes = parent_id ? await p.query(`SELECT level FROM accounts WHERE id = $1`, [parent_id]) : null;
      const level = parentLevelRes && (parentLevelRes.rowCount || 0) > 0 ? (parentLevelRes!.rows[0].level as number) + 1 : 0;
      await p.query(`INSERT INTO accounts (id, code, name, parent_id, level, type) VALUES ($1, $2, $3, $4, $5, $6)`, [id, code, name, parent_id ?? null, level, type]);
      return res.status(201).json({ id, message: t('accounts.created', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * PATCH /:id - Update an account.
 */
accountsRouter.patch('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  const parse = accountUpdateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { code, name, type, parent_id } = parse.data;
  try {
    if (usingSqlite()) {
      const d = getDb();
      const existing = d.prepare(`SELECT id FROM accounts WHERE id = ?`).get(id);
      if (!existing) return res.status(404).json({ ok: false, error: t('accounts.notFound', lang) });
      if (code) {
        const dup = d.prepare(`SELECT id FROM accounts WHERE code = ? AND id <> ?`).get(code, id);
        if (dup) return res.status(409).json({ ok: false, error: t('accounts.duplicateCode', lang) });
      }
      let level: number | null = null;
      if (parent_id !== undefined) {
        level = parent_id ? ((d.prepare(`SELECT level FROM accounts WHERE id = ?`).get(parent_id) as any)?.level ?? 0) + 1 : 0;
      }
      d.prepare(`UPDATE accounts SET code = COALESCE(?, code), name = COALESCE(?, name), parent_id = COALESCE(?, parent_id), level = COALESCE(?, level), type = COALESCE(?, type) WHERE id = ?`)
        .run(code ?? null, name ?? null, parent_id ?? null, level ?? null, type ?? null, id);
      return res.json({ id, message: t('accounts.updated', lang) });
    } else {
      const p = getPool();
      const existing = await p.query(`SELECT id FROM accounts WHERE id = $1`, [id]);
      if (existing.rowCount === 0) return res.status(404).json({ ok: false, error: t('accounts.notFound', lang) });
      if (code) {
        const dup = await p.query(`SELECT id FROM accounts WHERE code = $1 AND id <> $2`, [code, id]);
        if ((dup.rowCount || 0) > 0) return res.status(409).json({ ok: false, error: t('accounts.duplicateCode', lang) });
      }
      let level: number | null = null;
      if (parent_id !== undefined) {
        const parentLevelRes = parent_id ? await p.query(`SELECT level FROM accounts WHERE id = $1`, [parent_id]) : null;
        level = parentLevelRes && (parentLevelRes.rowCount || 0) > 0 ? (parentLevelRes!.rows[0].level as number) + 1 : 0;
      }
      const r = await p.query(`UPDATE accounts SET code = COALESCE($1, code), name = COALESCE($2, name), parent_id = COALESCE($3, parent_id), level = COALESCE($4, level), type = COALESCE($5, type) WHERE id = $6 RETURNING id`, [code ?? null, name ?? null, parent_id ?? null, level ?? null, type ?? null, id]);
      if (r.rowCount === 0) return res.status(404).json({ ok: false, error: t('accounts.notFound', lang) });
      return res.json({ id, message: t('accounts.updated', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * DELETE /:id - Delete an account.
 */
accountsRouter.delete('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    if (usingSqlite()) {
      const d = getDb();
      const r = d.prepare(`DELETE FROM accounts WHERE id = ?`).run(id);
      if (r.changes === 0) return res.status(404).json({ ok: false, error: t('accounts.notFound', lang) });
      return res.json({ id, message: t('accounts.deleted', lang) });
    } else {
      const p = getPool();
      const r = await p.query(`DELETE FROM accounts WHERE id = $1`, [id]);
      if ((r.rowCount || 0) === 0) return res.status(404).json({ ok: false, error: t('accounts.notFound', lang) });
      return res.json({ id, message: t('accounts.deleted', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * GET /tree - Build and return the account hierarchy.
 */
accountsRouter.get('/tree', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    let items: Array<{ id: string; code: string; name: string; parent_id: string | null; level: number; type: string }> = [];
    if (usingSqlite()) {
      const d = getDb();
      items = d.prepare(`SELECT id, code, name, parent_id, level, type FROM accounts ORDER BY code`).all() as any[];
    } else {
      const p = getPool();
      const r = await p.query(`SELECT id, code, name, parent_id, level, type FROM accounts ORDER BY code`);
      items = r.rows as any[];
    }
    const byId = new Map(items.map((a) => [a.id, { ...a, children: [] as any[] }]));
    const roots: any[] = [];
    for (const a of byId.values()) {
      if (a.parent_id && byId.has(a.parent_id)) {
        byId.get(a.parent_id)!.children.push(a);
      } else {
        roots.push(a);
      }
    }
    return res.json({ tree: roots, message: t('accounts.tree', lang) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});