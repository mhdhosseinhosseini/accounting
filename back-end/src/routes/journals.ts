import express, { Request, Response } from 'express';
import { z } from 'zod';
import { t, Lang } from '../i18n';
import { requireAuth } from '../middleware/auth';
import { getPool } from '../db/pg';

/**
 * Router for journal operations (list/get/create/update/delete/post/reverse).
 * Postgres-only implementation.
 */
export const journalsRouter = express.Router();

// All routes require authentication
journalsRouter.use(requireAuth);

/** Zod schema for journal item input. */
export const journalItemSchema = z.object({
  // Function: require a code_id for journal items; details/party optional
  code_id: z.string().uuid(),
  detail_id: z.string().uuid().nullable().optional(),
  party_id: z.string().uuid().nullable().optional(),
  debit: z.number().min(0),
  credit: z.number().min(0),
  description: z.string().max(200).nullable().optional(),
});

export const journalCreateSchema = z.object({
  // Function: validate journal creation payload including optional code and draft confirmation flag
  fiscal_year_id: z.string().uuid(),
  date: z.string(),
  code: z.string().max(50).nullable().optional(),
  ref_no: z.string().max(50).nullable().optional(),
  description: z.string().nullable().optional(),
  // NEW: optional journal classification fields for list/UI filtering
  type: z.string().max(50).nullable().optional(),
  provider: z.string().max(50).nullable().optional(),
  items: z.array(journalItemSchema).min(1),
  confirm_unbalanced: z.boolean().optional(),
  // Allow frontend to force save as draft (e.g., nature mismatch)
  force_draft: z.boolean().optional(),
});

export const journalUpdateSchema = z.object({
  // Function: validate journal update payload including optional code/items and draft confirmation flag
  date: z.string().optional(),
  code: z.string().max(50).nullable().optional(),
  ref_no: z.string().max(50).nullable().optional(),
  description: z.string().nullable().optional(),
  // NEW: optional journal classification fields for list/UI filtering
  type: z.string().max(50).nullable().optional(),
  provider: z.string().max(50).nullable().optional(),
  items: z.array(journalItemSchema).min(1).optional(),
  confirm_unbalanced: z.boolean().optional(),
  // Allow frontend to force save as draft (e.g., nature mismatch)
  force_draft: z.boolean().optional(),
});

/** Zod schema for auto New York journal input. */
const autoNewYorkSchema = z.object({
  fiscal_year_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().min(0.01),
  debit_code_id: z.string().uuid(),
  credit_code_id: z.string().uuid(),
  detail_id: z.string().uuid().optional(),
  description: z.string().optional()
});

/** Utility: compute total debit and credit for items.
 * Returns { debit, credit } as numbers.
 */
function computeTotals(items: Array<{ debit: number; credit: number }>): { debit: number; credit: number } {
  return items.reduce((acc, it) => ({ debit: acc.debit + Number(it.debit || 0), credit: acc.credit + Number(it.credit || 0) }), { debit: 0, credit: 0 });
}

/**
 * GET / - List journals with filters, sorting, and pagination.
 * Accepts query params: fy_id, date_from, date_to, status, type, provider, search, sort_by, sort_dir, page, page_size, code_from, code_to.
 * Adds filter and sorting for `type` (IN) and `provider` (ILIKE).
 */
journalsRouter.get('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    // Validate and coerce query params
    const querySchema = z.object({
      fy_id: z.string().uuid().optional(),
      date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      // Accept single, array, or comma-separated status values
      status: z.union([z.enum(['temporary', 'permanent', 'draft']), z.array(z.enum(['temporary', 'permanent', 'draft'])), z.string()]).optional(),
      // NEW: type filter supports single, array, or comma-separated values
      type: z.union([z.string(), z.array(z.string())]).optional(),
      // NEW: provider filter supports partial match via ILIKE
      provider: z.string().optional(),
      search: z.string().optional(),
      code_from: z.coerce.number().int().optional(),
      code_to: z.coerce.number().int().optional(),
      sort_by: z.enum(['date', 'ref_no', 'code', 'status', 'description', 'total', 'type', 'provider']).optional().default('date'),
      sort_dir: z.enum(['asc', 'desc']).optional().default('desc'),
      page: z.coerce.number().int().min(1).optional().default(1),
      page_size: z.coerce.number().int().min(1).max(100).optional().default(10)
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parsed.error.issues });
    }
    const { fy_id, date_from, date_to, status, search, code_from, code_to, sort_by, sort_dir, page, page_size } = parsed.data;
    // Build WHERE conditions and param list
    const whereClauses: string[] = [];
    const params: any[] = [];

    // Normalize status to an allowed array, supporting comma-separated values
    let statuses: string[] = [];
    if (Array.isArray(status)) {
      statuses = status as string[];
    } else if (typeof status === 'string' && status.trim().length > 0) {
      statuses = status.split(',').map((s) => s.trim()).filter(Boolean);
    }
    statuses = statuses.filter((s) => s === 'temporary' || s === 'permanent' || s === 'draft');

    // NEW: normalize type to an array, supporting comma-separated values
    let typesFilter: string[] = [];
    const typeParam: any = (parsed.data as any).type;
    if (Array.isArray(typeParam)) {
      typesFilter = typeParam.map((s) => String(s).trim()).filter(Boolean);
    } else if (typeof typeParam === 'string' && typeParam.trim().length > 0) {
      typesFilter = typeParam.split(',').map((s) => s.trim()).filter(Boolean);
    }

    if (fy_id) { params.push(fy_id); whereClauses.push(`j.fiscal_year_id = $${params.length}`); }
    if (date_from) { params.push(date_from); whereClauses.push(`j.date >= $${params.length}`); }
    if (date_to) { params.push(date_to); whereClauses.push(`j.date <= $${params.length}`); }
    if (statuses.length > 0) {
      const placeholders = statuses.map((_, i) => `$${params.length + i + 1}`).join(',');
      whereClauses.push(`j.status IN (${placeholders})`);
      params.push(...statuses);
    }
    // NEW: apply type filter
    if (typesFilter.length > 0) {
      const placeholders = typesFilter.map((_, i) => `$${params.length + i + 1}`).join(',');
      whereClauses.push(`j.type IN (${placeholders})`);
      params.push(...typesFilter);
    }
    // Numeric code range filter derived from code_from/code_to
    if (typeof code_from === 'number' || typeof code_to === 'number') {
      if (typeof code_from === 'number' && typeof code_to === 'number') {
        const from = Math.min(code_from, code_to);
        const to = Math.max(code_from, code_to);
        params.push(from);
        whereClauses.push(`j.code ~ '^[0-9]+' AND CAST(j.code AS INT) BETWEEN $${params.length} AND $${params.length + 1}`);
        params.push(to);
      } else if (typeof code_from === 'number') {
        params.push(code_from);
        whereClauses.push(`j.code ~ '^[0-9]+' AND CAST(j.code AS INT) >= $${params.length}`);
      } else if (typeof code_to === 'number') {
        params.push(code_to);
        whereClauses.push(`j.code ~ '^[0-9]+' AND CAST(j.code AS INT) <= $${params.length}`);
      }
    }
    // NEW: apply provider partial match filter
    const providerParam: string | undefined = (parsed.data as any).provider;
    if (providerParam && providerParam.trim().length > 0) {
      params.push(`%${providerParam.trim()}%`);
      whereClauses.push(`j.provider ILIKE $${params.length}`);
    }
    if (search && search.trim().length > 0) {
      params.push(`%${search.trim()}%`);
      const idx = params.length;
      whereClauses.push(`(j.ref_no ILIKE $${idx} OR j.code ILIKE $${idx} OR j.description ILIKE $${idx})`);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Count total rows without pagination
    const p = getPool();
    const countSql = `SELECT COUNT(*) AS cnt FROM journals j ${whereSql}`;
    const countRes = await p.query(countSql, params);
    const total = Number(countRes.rows[0]?.cnt || 0);

    // Map sort_by to safe SQL expression
    const sortMap: Record<string, string> = {
      date: 'j.date',
      ref_no: "CASE WHEN j.ref_no ~ '^[0-9]+' THEN CAST(j.ref_no AS INT) ELSE 0 END",
      code: "j.code",
      status: 'j.status',
      description: 'j.description',
      total: 'COALESCE(SUM(ji.debit), 0)',
      // NEW: allow sorting by type and provider
      type: 'j.type',
      provider: 'j.provider'
    };
    const sortExpr = sortMap[sort_by] || 'j.date';
    const sortDir = sort_dir.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // Pagination params
    const limit = page_size;
    const offset = (page - 1) * page_size;

    // Main query with aggregated total
    const dataSql = `
      SELECT j.id,
             j.serial_no,
             j.fiscal_year_id,
             j.ref_no,
             j.code,
             j.date,
             j.description,
             j.status,
             j.type,
             j.provider,
             COALESCE(SUM(ji.debit), 0) AS total
      FROM journals j
      LEFT JOIN journal_items ji ON ji.journal_id = j.id
      ${whereSql}
      GROUP BY j.id, j.serial_no, j.fiscal_year_id, j.ref_no, j.code, j.date, j.description, j.status, j.type, j.provider
      ORDER BY ${sortExpr} ${sortDir}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const dataParams = [...params, limit, offset];
    const r = await p.query(dataSql, dataParams);

    return res.json({ items: r.rows, total, page, page_size, message: t('journals.list', lang) });
  } catch (e) {
    console.error('List journals failed:', e);
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * GET /:id - Fetch a journal with its items.
 */
journalsRouter.get('/:id', async (req: Request, res: Response) => {
  // Function: fetch journal and items including specific/detail codes and cost center
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    const p = getPool();
    const jr = await p.query(`SELECT id, fiscal_year_id, ref_no, code, serial_no, date, description, status, type, provider FROM journals WHERE id = $1`, [id]);
    if (jr.rowCount === 0) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
    const ir = await p.query(`
      SELECT ji.id, ji.journal_id, ji.code_id, ji.party_id, ji.detail_id,
             ji.debit, ji.credit, ji.description,
             c.code AS account_code,
             c.title AS account_title,
             d.code AS detail_code,
             d.title AS detail_title
      FROM journal_items ji
      LEFT JOIN codes c ON c.id = ji.code_id
      LEFT JOIN details d ON d.id = ji.detail_id
      WHERE ji.journal_id = $1
    `, [id]);
    return res.json({ item: { ...jr.rows[0], items: ir.rows }, message: t('journals.fetchOne', lang) });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST / - Create a journal with items.
 * Always saves unbalanced journals as 'draft'; no blocking validation.
 * When `ref_no` is blank or missing, assigns the next sequential number
 * within the same fiscal year.
 */
journalsRouter.post('/', async (req: Request, res: Response) => {
  // Function: create a journal; save as draft if unbalanced and confirmed
  const lang: Lang = (req as any).lang || 'en';
  const parse = journalCreateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { fiscal_year_id, date, code, ref_no, description, type, provider, items, confirm_unbalanced, force_draft } = parse.data as any;
  const totals = computeTotals(items);
  const isUnbalanced = Math.abs(totals.debit - totals.credit) > 0.0001;
  const statusToSave = (force_draft || isUnbalanced) ? 'draft' : 'temporary';
  const id = require('crypto').randomUUID();
  try {
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      // Do NOT auto-assign ref_no on standard create; leave NULL unless provided
      const nextRef = (ref_no && ref_no.trim().length > 0) ? ref_no.trim() : null;
      // Auto-fill code if blank/missing: take max numeric code across journals and increment
      const providedCode = (code && code.trim().length > 0) ? code.trim() : null;
      let nextCode: string | null = providedCode;
      if (!nextCode) {
        const probeCode = await client.query(
          `SELECT COALESCE(MAX(CAST(code AS INT)), 0) AS max_code FROM journals WHERE code ~ '^[0-9]+'`
        );
        const maxCode = Number(probeCode.rows[0]?.max_code || 0);
        nextCode = String(maxCode + 1);
      }
      const ins = await client.query(
        `INSERT INTO journals (id, fiscal_year_id, ref_no, code, date, description, type, provider, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING serial_no`,
        [id, fiscal_year_id, nextRef, nextCode, date, description ?? null, type ?? null, provider ?? null, statusToSave]
      );
      const serialNo = ins.rows[0]?.serial_no;
      for (const it of items as any[]) {
        const itemId = require('crypto').randomUUID();
        await client.query(
          `INSERT INTO journal_items (id, journal_id, code_id, party_id, debit, credit, description, detail_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            itemId,
            id,
            String(it.code_id),
            null,
            it.debit,
            it.credit,
            it.description ?? null,
            it.detail_id ?? null
          ]
        );
      }
      await client.query('COMMIT');
      const messageKey = statusToSave === 'draft' ? 'journals.draftSaved' : 'journals.created';
      return res.status(201).json({ id, status: statusToSave, ref_no: nextRef, code: nextCode, serial_no: serialNo, message: t(messageKey as any, lang) });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    // Function: map DB errors to meaningful responses (duplicate ref_no → 409)
    const pgCode = (e as any)?.code;
    if (pgCode === '23505') {
      return res.status(409).json({ ok: false, error: t('journals.duplicateRefNo', lang) });
    }
    console.error('Create journal failed:', e);
    const body: any = { ok: false, error: t('error.generic', lang) };
    if (process.env.NODE_ENV !== 'production') body.debug = String((e as any)?.message || e);
    return res.status(500).json(body);
  }
});

/**
 * PATCH /:id - Update journal metadata or items (allowed in 'temporary' or 'draft').
 * Always saves unbalanced items as 'draft'; no blocking validation.
 * If items are balanced, ensure status becomes 'temporary'.
 * If `ref_no` is provided as an empty string, auto-assign the next number within the fiscal year.
 */
journalsRouter.patch('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  const parse = journalUpdateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  let { date, code, ref_no, description, type, provider, items, confirm_unbalanced, force_draft } = parse.data as any;
  try {
    const p = getPool();
    const jr = await p.query(`SELECT status, fiscal_year_id FROM journals WHERE id = $1`, [id]);
    if (jr.rowCount === 0) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
    const status = jr.rows[0].status as string;
    const fiscal_year_id = jr.rows[0].fiscal_year_id as string;
    if (status === 'permanent') return res.status(400).json({ ok: false, error: t('journals.cannotModifyPosted', lang) });
    // Auto-number if ref_no is explicitly blank
    if (typeof ref_no === 'string' && ref_no.trim() === '') {
      const probe = await p.query(
        `SELECT COALESCE(MAX(CAST(ref_no AS INT)), 0) AS max_ref
         FROM journals
         WHERE fiscal_year_id = $1 AND ref_no ~ '^[0-9]+'`,
        [fiscal_year_id]
      );
      const maxRef = Number(probe.rows[0]?.max_ref || 0);
      ref_no = String(maxRef + 1);
    }

    // Auto-fill code if explicitly blank
    if (typeof code === 'string' && code.trim() === '') {
      const probeCode = await p.query(
        `SELECT COALESCE(MAX(CAST(code AS INT)), 0) AS max_code FROM journals WHERE code ~ '^[0-9]+'`
      );
      const maxCode = Number(probeCode.rows[0]?.max_code || 0);
      code = String(maxCode + 1);
    }

    // If items provided, validate balance and replace items transactionally
    if (items && Array.isArray(items) && items.length > 0) {
      const totals = computeTotals(items);
      const isUnbalanced = Math.abs(totals.debit - totals.credit) > 0.0001;
      const nextStatus = (force_draft || isUnbalanced) ? 'draft' : 'temporary';
      const client = await p.connect();
      try {
        await client.query('BEGIN');
        const ur = await client.query(
          `UPDATE journals
           SET date = COALESCE($1, date),
               code = COALESCE($2, code),
               ref_no = COALESCE($3, ref_no),
               description = COALESCE($4, description),
               type = COALESCE($6, type),
               provider = COALESCE($7, provider),
               status = $8
           WHERE id = $5 RETURNING id, ref_no, code, type, provider, status`,
          [date ?? null, code ?? null, ref_no ?? null, description ?? null, id, type ?? null, provider ?? null, nextStatus]
        );
        if (ur.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
        }
        await client.query('DELETE FROM journal_items WHERE journal_id = $1', [id]);
        for (const it of items as any[]) {
          const itemId = require('crypto').randomUUID();
          await client.query(
            `INSERT INTO journal_items (id, journal_id, code_id, party_id, debit, credit, description, detail_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              itemId,
              id,
              String(it.code_id),
              null,
              it.debit,
              it.credit,
              it.description ?? null,
              it.detail_id ?? null
            ]
          );
        }
        await client.query('COMMIT');
        const msgKey = nextStatus === 'draft' ? 'journals.draftSaved' : 'journals.updated';
        return res.json({ id, ref_no: ur.rows[0].ref_no, code: ur.rows[0].code, status: ur.rows[0].status, message: t(msgKey as any, lang) });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      const ur = await p.query(
        `UPDATE journals
         SET date = COALESCE($1, date),
             code = COALESCE($2, code),
             ref_no = COALESCE($3, ref_no),
             description = COALESCE($4, description),
             type = COALESCE($6, type),
             provider = COALESCE($7, provider)
         WHERE id = $5 RETURNING id, ref_no, code, type, provider`,
        [date ?? null, code ?? null, ref_no ?? null, description ?? null, id, type ?? null, provider ?? null]
      );
      if (ur.rowCount === 0) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
      return res.json({ id, ref_no: ur.rows[0].ref_no, code: ur.rows[0].code, message: t('journals.updated', lang) });
    }
  } catch (e) {
    const pgCode = (e as any)?.code;
    if (pgCode === '23505') {
      return res.status(409).json({ ok: false, error: t('journals.duplicateRefNo', lang) });
    }
    console.error('Update journal failed:', e);
    const body: any = { ok: false, error: t('error.generic', lang) };
    if (process.env.NODE_ENV !== 'production') body.debug = String((e as any)?.message || e);
    return res.status(500).json(body);
  }
});

/**
 * POST /:id/post - Post a journal (validates balance).
 */
journalsRouter.post('/:id/post', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    const p = getPool();
    const jr = await p.query(`SELECT status, fiscal_year_id FROM journals WHERE id = $1`, [id]);
    if (jr.rowCount === 0) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
    const status = jr.rows[0].status as string;
    const fiscal_year_id = jr.rows[0].fiscal_year_id as string;
    if (status === 'permanent') return res.status(400).json({ ok: false, error: t('journals.cannotModifyPosted', lang) });
    const tr = await p.query(`SELECT SUM(debit) AS debit, SUM(credit) AS credit FROM journal_items WHERE journal_id = $1`, [id]);
    const debit = Number(tr.rows[0]?.debit || 0);
    const credit = Number(tr.rows[0]?.credit || 0);
    if (Math.abs(debit - credit) > 0.0001) return res.status(400).json({ ok: false, error: t('journals.unbalanced', lang) });
    await p.query(`UPDATE journals SET status = 'permanent' WHERE id = $1`, [id]);
    return res.json({ id, status: 'permanent', message: t('journals.posted', lang) });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * DELETE /:id - Delete a journal (allowed in 'temporary' or 'draft').
 */
journalsRouter.delete('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    const p = getPool();
    const jr = await p.query(`SELECT status, fiscal_year_id FROM journals WHERE id = $1`, [id]);
    if (jr.rowCount === 0) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
    const status = jr.rows[0].status as string;
    const fiscal_year_id = jr.rows[0].fiscal_year_id as string;
    if (status === 'permanent') return res.status(400).json({ ok: false, error: t('journals.cannotDeletePosted', lang) });
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      // Revert any linked receipts back to 'temporary' and clear journal link
      await client.query(`UPDATE receipts SET status = 'temporary', journal_id = NULL WHERE journal_id = $1`, [id]);
      const r = await client.query(`DELETE FROM journals WHERE id = $1`, [id]);
      if ((r.rowCount || 0) === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
      }
      await client.query('COMMIT');
      return res.json({ id, message: t('journals.deleted', lang) });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST /:id/reverse - Reverse a posted journal by creating a new posted journal
 * with debit/credit swapped per item. Transactional.
 */
journalsRouter.post('/:id/reverse', async (req: Request, res: Response) => {
  // Function: create reversal journal using code_id field
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    const p = getPool();
    const jr = await p.query(`SELECT id, fiscal_year_id, ref_no, date, status, description FROM journals WHERE id = $1`, [id]);
  if (jr.rowCount === 0) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
  const j = jr.rows[0] as any;
  if (String(j.status) !== 'permanent') return res.status(400).json({ ok: false, error: t('journals.cannotReverseDraft', lang) });
    const ir = await p.query(`SELECT code_id, party_id, debit, credit, description FROM journal_items WHERE journal_id = $1`, [id]);
    const items = ir.rows as any[];
    const client = await p.connect();
    const newId = require('crypto').randomUUID();
    const newRef = j.ref_no ? `REV-${j.ref_no}` : `REV-${String(id).slice(0, 8)}`;
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO journals (id, fiscal_year_id, ref_no, date, description, status) VALUES ($1, $2, $3, $4, $5, 'permanent')`, [
        newId,
        j.fiscal_year_id,
        newRef,
        j.date,
        (j.description ? `Reversal of ${id}: ${j.description}` : `Reversal of ${id}`)
      ]);
      for (const it of items) {
        const itemId = require('crypto').randomUUID();
        await client.query(
          `INSERT INTO journal_items (id, journal_id, code_id, party_id, debit, credit, description) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            itemId,
            newId,
            it.code_id,
            null,
            Number(it.credit || 0),
            Number(it.debit || 0),
            it.description ? `Reversal: ${it.description}` : 'Reversal'
          ]
        );
      }
      await client.query('COMMIT');
      return res.json({ id: newId, status: 'permanent', message: t('journals.reversed', lang) });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST /auto/new-york - Create a balanced two-line journal for New York.
 * Uses provided debit/credit code IDs and optional detail/cost center.
 * Auto-assigns the next sequential ref_no within the fiscal year.
 */
journalsRouter.post('/auto/new-york', async (req: Request, res: Response) => {
  // Function: generate an automatic New York journal with two items using code_id
  const lang: Lang = (req as any).lang || 'en';
  const parse = autoNewYorkSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { fiscal_year_id, date, amount, debit_code_id, credit_code_id, description, detail_id } = parse.data as any;
  try {
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');

      // Compute next ref_no within fiscal year
      const probe = await client.query(
        `SELECT COALESCE(MAX(CAST(ref_no AS INT)), 0) AS max_ref
         FROM journals
         WHERE fiscal_year_id = $1 AND ref_no ~ '^[0-9]+'`,
        [fiscal_year_id]
      );
      const maxRef = Number(probe.rows[0]?.max_ref || 0);
      const nextRef = String(maxRef + 1);

      const id = require('crypto').randomUUID();
      const ins2 = await client.query(
        `INSERT INTO journals (id, fiscal_year_id, ref_no, date, description, status)
         VALUES ($1, $2, $3, $4, $5, 'temporary') RETURNING serial_no`,
        [id, fiscal_year_id, nextRef, date, description ?? 'New York automatic journal']
      );
      const serialNo2 = ins2.rows[0]?.serial_no;

      // Insert two items: debit and credit
      const debitItemId = require('crypto').randomUUID();
      await client.query(
        `INSERT INTO journal_items (id, journal_id, code_id, party_id, debit, credit, description, detail_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          debitItemId,
          id,
          debit_code_id,
          null,
          amount,
          0,
          'NY debit',
          detail_id ?? null
        ]
      );

      const creditItemId = require('crypto').randomUUID();
      await client.query(
        `INSERT INTO journal_items (id, journal_id, code_id, party_id, debit, credit, description, detail_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          creditItemId,
          id,
          credit_code_id,
          null,
          0,
          amount,
          'NY credit',
          detail_id ?? null
        ]
      );

      // Confirm balance server-side (defensive)
      const tr = await client.query(`SELECT SUM(debit) AS debit, SUM(credit) AS credit FROM journal_items WHERE journal_id = $1`, [id]);
      const debit = Number(tr.rows[0]?.debit || 0);
      const credit = Number(tr.rows[0]?.credit || 0);
      if (Math.abs(debit - credit) > 0.0001) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: t('journals.unbalanced', lang) });
      }

      await client.query('COMMIT');
      return res.status(201).json({ id, status: 'temporary', ref_no: nextRef, serial_no: serialNo2, message: t('journals.autoNewYorkCreated', lang) });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    // Function: map DB errors to meaningful responses (duplicate ref_no → 409)
    const pgCode = (e as any)?.code;
    if (pgCode === '23505') {
      return res.status(409).json({ ok: false, error: t('journals.duplicateRefNo', lang) });
    }
    console.error('Auto New York journal failed:', e);
    const body: any = { ok: false, error: t('error.generic', lang) };
    if (process.env.NODE_ENV !== 'production') body.debug = String((e as any)?.message || e);
    return res.status(500).json(body);
  }
});

/**
 * POST /bulk-post
 * Posts all draft journals matching provided filters. Only balanced journals
 * (sum(debit) equals sum(credit)) are posted. Returns affected row count.
 */
journalsRouter.post('/bulk-post', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const bodySchema = z.object({
    fy_id: z.string().uuid().optional(),
    date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    // Accept single, array, or comma-separated status values (ignored; temporary enforced)
    status: z.union([z.enum(['temporary', 'permanent']), z.array(z.enum(['temporary', 'permanent'])), z.string()]).optional(),
    search: z.string().optional(),
    code_from: z.coerce.number().int().optional(),
    code_to: z.coerce.number().int().optional(),
  });
  const parse = bodySchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  }
  const { fy_id, date_from, date_to, status, search, code_from, code_to } = parse.data;
  try {
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');

      const whereClauses: string[] = [];
      const params: any[] = [];

      if (fy_id) { params.push(fy_id); whereClauses.push(`j.fiscal_year_id = $${params.length}`); }
      if (date_from) { params.push(date_from); whereClauses.push(`j.date >= $${params.length}`); }
      if (date_to) { params.push(date_to); whereClauses.push(`j.date <= $${params.length}`); }

      // Normalize status values; drafts are enforced regardless
      let statuses: string[] = [];
      if (Array.isArray(status)) {
        statuses = status as string[];
      } else if (typeof status === 'string' && status.trim().length > 0) {
        statuses = status.split(',').map((s) => s.trim()).filter(Boolean);
      }
      statuses = statuses.filter((s) => s === 'temporary' || s === 'permanent');

      // Always restrict to temporary
      whereClauses.push(`j.status = 'temporary'`);

      // Numeric code range filter derived from code_from/code_to (bulk post)
      if (typeof code_from === 'number' || typeof code_to === 'number') {
        if (typeof code_from === 'number' && typeof code_to === 'number') {
          const from = Math.min(code_from, code_to);
          const to = Math.max(code_from, code_to);
          params.push(from);
          whereClauses.push(`j.code ~ '^[0-9]+' AND CAST(j.code AS INT) BETWEEN $${params.length} AND $${params.length + 1}`);
          params.push(to);
        } else if (typeof code_from === 'number') {
          params.push(code_from);
          whereClauses.push(`j.code ~ '^[0-9]+' AND CAST(j.code AS INT) >= $${params.length}`);
        } else if (typeof code_to === 'number') {
          params.push(code_to);
          whereClauses.push(`j.code ~ '^[0-9]+' AND CAST(j.code AS INT) <= $${params.length}`);
        }
      }

      if (search && search.trim().length > 0) {
        params.push(`%${search.trim()}%`);
        const idx = params.length;
        whereClauses.push(`(j.ref_no ILIKE $${idx} OR j.code ILIKE $${idx} OR j.description ILIKE $${idx})`);
      }

      const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const sql = `
        WITH eligible AS (
          SELECT j.id
          FROM journals j
          LEFT JOIN (
            SELECT journal_id, SUM(debit) AS debit, SUM(credit) AS credit
            FROM journal_items
            GROUP BY journal_id
          ) agg ON agg.journal_id = j.id
          ${whereSql}
          AND COALESCE(agg.debit, 0) = COALESCE(agg.credit, 0)
        )
        UPDATE journals AS j
        SET status = 'permanent'
        FROM eligible
        WHERE j.id = eligible.id
      `;
      const result = await client.query(sql, params);
      await client.query('COMMIT');
      return res.json({ ok: true, affected: result.rowCount || 0, message: t('journals.posted', lang) });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Bulk post failed:', e);
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST /reorder-codes
 * Reorders journal `code` values sequentially within a single fiscal year,
 * using ascending document `date` (oldest first). Ties are resolved by
 * numeric `ref_no`, then numeric `code`, then `id` for determinism.
 * Returns the number of affected rows.
 */
journalsRouter.post('/reorder-codes', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const bodySchema = z.object({
    fiscal_year_id: z.string().uuid(),
  });
  const parse = bodySchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  }
  const { fiscal_year_id } = parse.data;
  try {
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      // Generate a deterministic order and assign row_number() as new codes
      const sql = `
        WITH ordered AS (
          SELECT j.id,
                 ROW_NUMBER() OVER (
                   ORDER BY j.date ASC,
                            CASE WHEN j.ref_no ~ '^[0-9]+' THEN CAST(j.ref_no AS INT) ELSE NULL END ASC NULLS LAST,
                            CASE WHEN j.code   ~ '^[0-9]+' THEN CAST(j.code   AS INT) ELSE NULL END ASC NULLS LAST,
                            j.id ASC
                 ) AS seq
          FROM journals j
          WHERE j.fiscal_year_id = $1
        )
        UPDATE journals AS j
        SET code = ordered.seq::text
        FROM ordered
        WHERE j.id = ordered.id;
      `;
      const result = await client.query(sql, [fiscal_year_id]);
      await client.query('COMMIT');
      return res.json({ ok: true, affected: result.rowCount || 0, message: t('journals.updated', lang) });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Reorder codes failed:', e);
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * Resolve account_id from a provided code_id.
 * - Reads `code` and `title` from `codes` by `id`.
 * - Finds an existing `accounts` row with matching `code`; creates one if missing.
 * - Uses a generic type `unknown` when creating new accounts.
 * Returns the resolved `accounts.id`.
 */
async function resolveAccountIdFromCodeId(client: any, codeId: string): Promise<string> {
  const cr = await client.query('SELECT code, title FROM codes WHERE id = $1', [codeId]);
  const row = cr.rows?.[0];
  if (!row?.code) throw new Error('Invalid code_id');
  const code = String(row.code);
  const title = String(row.title || row.code);
  const ar = await client.query('SELECT id FROM accounts WHERE code = $1', [code]);
  if (ar.rows?.[0]?.id) return String(ar.rows[0].id);
  const newId = require('crypto').randomUUID();
  const ir = await client.query(
    `INSERT INTO accounts (id, code, name, level, type)
     VALUES ($1, $2, $3, 0, $4)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [newId, code, title, 'unknown']
  );
  return String(ir.rows?.[0]?.id || newId);
}