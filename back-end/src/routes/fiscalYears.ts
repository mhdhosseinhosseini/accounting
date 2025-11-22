import express, { Request, Response } from 'express';
import { z } from 'zod';
import { t, Lang } from '../i18n';
import { requireAuth } from '../middleware/auth';
import { getPool } from '../db/pg';

/**
 * Router for fiscal year operations (list/create/update/close).
 * Postgres-only implementation.
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

/**
 * GET / - List fiscal years.
 * Includes `has_documents` boolean for UI to hide delete when needed.
 */
fiscalYearsRouter.get('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    // Postgres-only list implementation
    const p = getPool();
    const r = await p.query(`
      SELECT
        fy.id,
        fy.name,
        fy.start_date,
        fy.end_date,
        fy.is_closed,
        (EXISTS(SELECT 1 FROM journals j WHERE j.fiscal_year_id = fy.id)
         OR EXISTS(SELECT 1 FROM invoices i WHERE i.fiscal_year_id = fy.id)) AS has_documents
      FROM fiscal_years fy
      ORDER BY fy.start_date DESC
    `);
    return res.json({ items: r.rows, message: t('fiscalYears.list', lang) });
  } catch {
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
    // Postgres-only fetch-one implementation
    const p = getPool();
    const r = await p.query(`SELECT id, name, start_date, end_date, is_closed FROM fiscal_years WHERE id = $1`, [id]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: t('fiscalYears.notFound', lang) });
    return res.json({ item: r.rows[0], message: t('fiscalYears.fetchOne', lang) });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST / - Create a fiscal year.
 * Default: new fiscal years are created closed (is_closed = TRUE).
 */
fiscalYearsRouter.post('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const parse = fiscalYearCreateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { name, start_date, end_date } = parse.data;
  if (new Date(start_date) > new Date(end_date)) return res.status(400).json({ ok: false, error: t('fiscalYears.invalidRange', lang) });
  const id = require('crypto').randomUUID();
  try {
    // Postgres-only create implementation
    const p = getPool();
    await p.query(`INSERT INTO fiscal_years (id, name, start_date, end_date, is_closed) VALUES ($1, $2, $3, $4, TRUE)`, [id, name, start_date, end_date]);
    return res.status(201).json({ id, message: t('fiscalYears.created', lang) });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * PATCH /:id - Update a fiscal year.
 * - If the fiscal year has documents, dates cannot be edited.
 */
fiscalYearsRouter.patch('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  const parse = fiscalYearUpdateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { name, start_date, end_date } = parse.data;
  if (start_date && end_date && new Date(start_date) > new Date(end_date)) return res.status(400).json({ ok: false, error: t('fiscalYears.invalidRange', lang) });
  try {
    const p = getPool();

    // Guard: if dates are being edited and fiscal year has documents, block
    if (start_date || end_date) {
      const dep = await p.query(
        `SELECT (EXISTS(SELECT 1 FROM journals WHERE fiscal_year_id = $1)
                 OR EXISTS(SELECT 1 FROM invoices WHERE fiscal_year_id = $1)) AS has_documents`,
        [id]
      );
      if (dep.rows[0]?.has_documents) {
        return res.status(409).json({ ok: false, error: t('fiscalYears.cannotEditDatesWithDocuments', lang) });
      }
    }

    // Postgres-only update implementation
    const r = await p.query(`UPDATE fiscal_years SET name = COALESCE($1, name), start_date = COALESCE($2, start_date), end_date = COALESCE($3, end_date) WHERE id = $4 RETURNING id`, [name ?? null, start_date ?? null, end_date ?? null, id]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: t('fiscalYears.notFound', lang) });
    return res.json({ id, message: t('fiscalYears.updated', lang) });
  } catch {
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
    // Postgres-only close implementation
    const p = getPool();
    const r = await p.query(`UPDATE fiscal_years SET is_closed = TRUE WHERE id = $1 RETURNING id`, [id]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: t('fiscalYears.notFound', lang) });
    return res.json({ id, message: t('fiscalYears.closed', lang) });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST /:id/open - Open a fiscal year exclusively (close all others).
 * Ensures only one open fiscal year exists at any time.
 */
fiscalYearsRouter.post('/:id/open', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  const p = getPool();
  try {
    // Verify existence and current state
    const r0 = await p.query(`SELECT id, is_closed FROM fiscal_years WHERE id = $1`, [id]);
    if (r0.rowCount === 0) return res.status(404).json({ ok: false, error: t('fiscalYears.notFound', lang) });
    const row = r0.rows[0] as any;
    if (row.is_closed === false) {
      return res.json({ id, message: t('fiscalYears.alreadyOpen', lang) });
    }
    // Perform exclusive open within a transaction
    await p.query('BEGIN');
    await p.query(`UPDATE fiscal_years SET is_closed = TRUE WHERE id <> $1`, [id]);
    const r = await p.query(`UPDATE fiscal_years SET is_closed = FALSE WHERE id = $1 RETURNING id`, [id]);
    await p.query('COMMIT');
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: t('fiscalYears.notFound', lang) });
    return res.json({ id, message: t('fiscalYears.opened', lang) });
  } catch (e) {
    try { await p.query('ROLLBACK'); } catch {}
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
    // Postgres-only open-next implementation
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
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * DELETE /:id - Delete a fiscal year.
 * Prevents deletion if any journals or invoices exist for the fiscal year.
 * If allowed, cascades opening/closing entries; other documents set fiscal_year_id NULL.
 */
fiscalYearsRouter.delete('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  const p = getPool();
  try {
    // Begin transaction: we may need to reassign the open fiscal year
    await p.query('BEGIN');
    const r0 = await p.query(`SELECT id, start_date, is_closed FROM fiscal_years WHERE id = $1 FOR UPDATE`, [id]);
    if (r0.rowCount === 0) { await p.query('ROLLBACK'); return res.status(404).json({ ok: false, error: t('fiscalYears.notFound', lang) }); }
    const dep = await p.query(
      `SELECT (EXISTS(SELECT 1 FROM journals WHERE fiscal_year_id = $1)
               OR EXISTS(SELECT 1 FROM invoices WHERE fiscal_year_id = $1)) AS has_documents`,
      [id]
    );
    if (dep.rows[0]?.has_documents) {
      await p.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: t('fiscalYears.hasDocuments', lang) });
    }
    const row = r0.rows[0] as any;
    const wasOpen = row.is_closed === false;
    let fallbackId: string | null = null;
    if (wasOpen) {
      const prevRes = await p.query(`SELECT id FROM fiscal_years WHERE start_date < $1 ORDER BY start_date DESC LIMIT 1`, [row.start_date]);
      if ((prevRes.rowCount ?? 0) > 0) {
        fallbackId = prevRes.rows[0].id;
      } else {
        const nextRes = await p.query(`SELECT id FROM fiscal_years WHERE start_date > $1 ORDER BY start_date ASC LIMIT 1`, [row.start_date]);
        if ((nextRes.rowCount ?? 0) > 0) fallbackId = nextRes.rows[0].id;
      }
    }
    const del = await p.query(`DELETE FROM fiscal_years WHERE id = $1`, [id]);
    if ((del.rowCount || 0) === 0) { await p.query('ROLLBACK'); return res.status(404).json({ ok: false, error: t('fiscalYears.notFound', lang) }); }
    if (wasOpen && fallbackId) {
      // Exclusive open: close all, then open the fallback fiscal year
      await p.query(`UPDATE fiscal_years SET is_closed = TRUE`);
      await p.query(`UPDATE fiscal_years SET is_closed = FALSE WHERE id = $1`, [fallbackId]);
    }
    await p.query('COMMIT');
    return res.json({ id, message: t('fiscalYears.deleted', lang), opened_id: fallbackId || undefined });
  } catch {
    try { await p.query('ROLLBACK'); } catch {}
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});