import express, { Request, Response } from 'express';
import { z } from 'zod';
import { t, Lang } from '../i18n';
import { requireAuth } from '../middleware/auth';
import { getPool } from '../db/pg';
import { getDb } from '../db/sqlite';

/**
 * Router for fiscal year operations (list/create/update/close).
 * Supports both Postgres and SQLite via env-driven driver selection.
 */
export const fiscalYearsRouter = express.Router();

// All routes require authentication
fiscalYearsRouter.use(requireAuth);

/**
 * Validate fiscal year input.
 */
const fiscalYearCreateSchema = z.object({
  name: z.string().min(1),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const fiscalYearUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function usingSqlite() {
  return (process.env.DB_DRIVER || '').toLowerCase() === 'sqlite';
}

/**
 * GET / - List fiscal years.
 */
fiscalYearsRouter.get('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    if (usingSqlite()) {
      const d = getDb();
      const items = d.prepare(`SELECT id, name, start_date, end_date, is_closed FROM fiscal_years ORDER BY start_date DESC`).all();
      return res.json({ items, message: t('fiscalYears.list', lang) });
    } else {
      const p = getPool();
      const r = await p.query(`SELECT id, name, start_date, end_date, is_closed FROM fiscal_years ORDER BY start_date DESC`);
      return res.json({ items: r.rows, message: t('fiscalYears.list', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * GET /:id - Get a fiscal year.
 */
fiscalYearsRouter.get('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    if (usingSqlite()) {
      const d = getDb();
      const row = d.prepare(`SELECT id, name, start_date, end_date, is_closed FROM fiscal_years WHERE id = ?`).get(id);
      if (!row) return res.status(404).json({ ok: false, error: t('fiscalYears.notFound', lang) });
      return res.json({ item: row, message: t('fiscalYears.fetchOne', lang) });
    } else {
      const p = getPool();
      const r = await p.query(`SELECT id, name, start_date, end_date, is_closed FROM fiscal_years WHERE id = $1`, [id]);
      if (r.rowCount === 0) return res.status(404).json({ ok: false, error: t('fiscalYears.notFound', lang) });
      return res.json({ item: r.rows[0], message: t('fiscalYears.fetchOne', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST / - Create a fiscal year.
 */
fiscalYearsRouter.post('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const parse = fiscalYearCreateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { name, start_date, end_date } = parse.data;
  if (new Date(start_date) > new Date(end_date)) return res.status(400).json({ ok: false, error: t('fiscalYears.invalidRange', lang) });

  const id = require('crypto').randomUUID();
  try {
    if (usingSqlite()) {
      const d = getDb();
      d.prepare(`INSERT INTO fiscal_years (id, name, start_date, end_date, is_closed) VALUES (?, ?, ?, ?, 0)`).run(id, name, start_date, end_date);
      return res.status(201).json({ id, message: t('fiscalYears.created', lang) });
    } else {
      const p = getPool();
      await p.query(`INSERT INTO fiscal_years (id, name, start_date, end_date, is_closed) VALUES ($1, $2, $3, $4, FALSE)`, [id, name, start_date, end_date]);
      return res.status(201).json({ id, message: t('fiscalYears.created', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * PATCH /:id - Update a fiscal year.
 */
fiscalYearsRouter.patch('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  const parse = fiscalYearUpdateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });

  const { name, start_date, end_date } = parse.data;
  if (start_date && end_date && new Date(start_date) > new Date(end_date)) return res.status(400).json({ ok: false, error: t('fiscalYears.invalidRange', lang) });

  try {
    if (usingSqlite()) {
      const d = getDb();
      const existing = d.prepare(`SELECT id FROM fiscal_years WHERE id = ?`).get(id);
      if (!existing) return res.status(404).json({ ok: false, error: t('fiscalYears.notFound', lang) });
      const upd = d.prepare(`UPDATE fiscal_years SET name = COALESCE(?, name), start_date = COALESCE(?, start_date), end_date = COALESCE(?, end_date) WHERE id = ?`);
      upd.run(name ?? null, start_date ?? null, end_date ?? null, id);
      return res.json({ id, message: t('fiscalYears.updated', lang) });
    } else {
      const p = getPool();
      const r = await p.query(`UPDATE fiscal_years SET name = COALESCE($1, name), start_date = COALESCE($2, start_date), end_date = COALESCE($3, end_date) WHERE id = $4 RETURNING id`, [name ?? null, start_date ?? null, end_date ?? null, id]);
      if (r.rowCount === 0) return res.status(404).json({ ok: false, error: t('fiscalYears.notFound', lang) });
      return res.json({ id, message: t('fiscalYears.updated', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST /:id/close - Close a fiscal year.
 */
fiscalYearsRouter.post('/:id/close', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    if (usingSqlite()) {
      const d = getDb();
      const existing = d.prepare(`SELECT id FROM fiscal_years WHERE id = ?`).get(id);
      if (!existing) return res.status(404).json({ ok: false, error: t('fiscalYears.notFound', lang) });
      d.prepare(`UPDATE fiscal_years SET is_closed = 1 WHERE id = ?`).run(id);
      return res.json({ id, message: t('fiscalYears.closed', lang) });
    } else {
      const p = getPool();
      const r = await p.query(`UPDATE fiscal_years SET is_closed = TRUE WHERE id = $1 RETURNING id`, [id]);
      if (r.rowCount === 0) return res.status(404).json({ ok: false, error: t('fiscalYears.notFound', lang) });
      return res.json({ id, message: t('fiscalYears.closed', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * Helper: format a JS Date to YYYY-MM-DD
 */
function fmt(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * POST /:id/open-next - Create and open the next fiscal year.
 * Requires current fiscal year to be closed; computes next year as
 * [end_date + 1 day, same day next year - 1 day]. Prevents duplicates.
 */
fiscalYearsRouter.post('/:id/open-next', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  const nameOverride = (req.body?.name as string | undefined) || undefined;
  try {
    if (usingSqlite()) {
      const d = getDb();
      const row = d.prepare(`SELECT id, name, start_date, end_date, is_closed FROM fiscal_years WHERE id = ?`).get(id) as any;
      if (!row) return res.status(404).json({ ok: false, error: t('fiscalYears.notFound', lang) });
      if (!(row.is_closed === 1 || row.is_closed === true)) return res.status(400).json({ ok: false, error: t('fiscalYears.mustBeClosed', lang) });
      const end = new Date(row.end_date);
      const nextStart = new Date(end);
      nextStart.setDate(nextStart.getDate() + 1);
      const nextEnd = new Date(nextStart);
      nextEnd.setFullYear(nextEnd.getFullYear() + 1);
      nextEnd.setDate(nextEnd.getDate() - 1);
      const nextStartStr = fmt(nextStart);
      const nextEndStr = fmt(nextEnd);
      const exists = d.prepare(`SELECT id FROM fiscal_years WHERE start_date = ?`).get(nextStartStr);
      if (exists) return res.status(409).json({ ok: false, error: t('fiscalYears.nextAlreadyExists', lang) });
      const newId = require('crypto').randomUUID();
      const nextName = nameOverride || `${row.name} (Next)`;
      d.prepare(`INSERT INTO fiscal_years (id, name, start_date, end_date, is_closed) VALUES (?, ?, ?, ?, 0)`).run(newId, nextName, nextStartStr, nextEndStr);
      return res.status(201).json({ id: newId, message: t('fiscalYears.openedNext', lang) });
    } else {
      const p = getPool();
      const r = await p.query(`SELECT id, name, start_date, end_date, is_closed FROM fiscal_years WHERE id = $1`, [id]);
      if (r.rowCount === 0) return res.status(404).json({ ok: false, error: t('fiscalYears.notFound', lang) });
      const row = r.rows[0] as any;
      if (!(row.is_closed === true)) return res.status(400).json({ ok: false, error: t('fiscalYears.mustBeClosed', lang) });
      const end = new Date(row.end_date);
      const nextStart = new Date(end);
      nextStart.setDate(nextStart.getDate() + 1);
      const nextEnd = new Date(nextStart);
      nextEnd.setFullYear(nextEnd.getFullYear() + 1);
      nextEnd.setDate(nextEnd.getDate() - 1);
      const nextStartStr = fmt(nextStart);
      const nextEndStr = fmt(nextEnd);
      const er = await p.query(`SELECT id FROM fiscal_years WHERE start_date = $1`, [nextStartStr]);
      if (Number(er.rowCount || 0) > 0) return res.status(409).json({ ok: false, error: t('fiscalYears.nextAlreadyExists', lang) });
      const newId = require('crypto').randomUUID();
      const nextName = nameOverride || `${row.name} (Next)`;
      await p.query(`INSERT INTO fiscal_years (id, name, start_date, end_date, is_closed) VALUES ($1, $2, $3, $4, FALSE)`, [newId, nextName, nextStartStr, nextEndStr]);
      return res.status(201).json({ id: newId, message: t('fiscalYears.openedNext', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});