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
  // Function: validate a journal item payload including optional description; accepts account_id or code_id
  account_id: z.string().uuid().optional(),
  code_id: z.string().uuid().optional(),
  detail_id: z.string().uuid().nullable().optional(),
  party_id: z.string().uuid().nullable().optional(),
  debit: z.number().min(0),
  credit: z.number().min(0),
  description: z.string().max(200).nullable().optional(),
}).refine((it) => !!it.account_id || !!it.code_id, {
  path: ['account_id'],
  message: 'Either account_id or code_id must be provided',
});

export const journalCreateSchema = z.object({
  // Function: validate journal creation payload including optional code
  fiscal_year_id: z.string().uuid(),
  date: z.string(),
  code: z.string().max(50).nullable().optional(),
  ref_no: z.string().max(50).nullable().optional(),
  description: z.string().nullable().optional(),
  items: z.array(journalItemSchema).min(1),
});

export const journalUpdateSchema = z.object({
  // Function: validate journal update payload including optional code and items
  date: z.string().optional(),
  code: z.string().max(50).nullable().optional(),
  ref_no: z.string().max(50).nullable().optional(),
  description: z.string().nullable().optional(),
  items: z.array(journalItemSchema).min(1).optional(),
});

/** Zod schema for auto New York journal input. */
const autoNewYorkSchema = z.object({
  fiscal_year_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().min(0.01),
  debit_account_id: z.string().uuid(),
  credit_account_id: z.string().uuid(),
  description: z.string().optional()
});

/** Utility: compute total debit and credit for items.
 * Returns { debit, credit } as numbers.
 */
function computeTotals(items: Array<{ debit: number; credit: number }>): { debit: number; credit: number } {
  return items.reduce((acc, it) => ({ debit: acc.debit + Number(it.debit || 0), credit: acc.credit + Number(it.credit || 0) }), { debit: 0, credit: 0 });
}

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

/**
 * GET / - List journals with filters, sorting, and pagination.
 * Accepts query params: fy_id, date_from, date_to, status, search, sort_by, sort_dir, page, page_size, code_from, code_to.
 * Filters are applied on journal headers; type/provider are not supported (no columns).
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
      status: z.union([z.enum(['draft', 'posted']), z.array(z.enum(['draft', 'posted'])), z.string()]).optional(),
      search: z.string().optional(),
      code_from: z.coerce.number().int().optional(),
      code_to: z.coerce.number().int().optional(),
      sort_by: z.enum(['date', 'ref_no', 'code', 'status', 'description', 'total']).optional().default('date'),
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
    statuses = statuses.filter((s) => s === 'draft' || s === 'posted');

    if (fy_id) { params.push(fy_id); whereClauses.push(`j.fiscal_year_id = $${params.length}`); }
    if (date_from) { params.push(date_from); whereClauses.push(`j.date >= $${params.length}`); }
    if (date_to) { params.push(date_to); whereClauses.push(`j.date <= $${params.length}`); }
    if (statuses.length > 0) {
      const placeholders = statuses.map((_, i) => `$${params.length + i + 1}`).join(',');
      whereClauses.push(`j.status IN (${placeholders})`);
      params.push(...statuses);
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
      total: 'COALESCE(SUM(ji.debit), 0)'
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
             COALESCE(SUM(ji.debit), 0) AS total
      FROM journals j
      LEFT JOIN journal_items ji ON ji.journal_id = j.id
      ${whereSql}
      GROUP BY j.id, j.serial_no, j.fiscal_year_id, j.ref_no, j.code, j.date, j.description, j.status
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
    const jr = await p.query(`SELECT id, fiscal_year_id, ref_no, code, serial_no, date, description, status FROM journals WHERE id = $1`, [id]);
    if (jr.rowCount === 0) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
    const ir = await p.query(`
      SELECT ji.id, ji.journal_id, ji.account_id, ji.party_id, ji.detail_id,
             ji.debit, ji.credit, ji.description,
             a.code AS account_code
      FROM journal_items ji
      LEFT JOIN accounts a ON a.id = ji.account_id
      WHERE ji.journal_id = $1
    `, [id]);
    return res.json({ item: { ...jr.rows[0], items: ir.rows }, message: t('journals.fetchOne', lang) });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST / - Create a draft journal with items.
 * Validates double-entry balance before persistence.
 * When `ref_no` is blank or missing, assigns the next sequential number
 * within the same fiscal year.
 */
journalsRouter.post('/', async (req: Request, res: Response) => {
  // Function: create a new draft journal and its items referencing accounts
  const lang: Lang = (req as any).lang || 'en';
  const parse = journalCreateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { fiscal_year_id, date, code, ref_no, description, items } = parse.data;
  const totals = computeTotals(items);
  if (Math.abs(totals.debit - totals.credit) > 0.0001) return res.status(400).json({ ok: false, error: t('journals.unbalanced', lang) });
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
          `SELECT COALESCE(MAX(CAST(code AS INT)), 0) AS max_code FROM journals WHERE code ~ '^[0-9]+$'`
        );
        const maxCode = Number(probeCode.rows[0]?.max_code || 0);
        nextCode = String(maxCode + 1);
      }
      const ins = await client.query(
        `INSERT INTO journals (id, fiscal_year_id, ref_no, code, date, description, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft') RETURNING serial_no`,
        [id, fiscal_year_id, nextRef, nextCode, date, description ?? null]
      );
      const serialNo = ins.rows[0]?.serial_no;
      for (const it of items) {
        const itemId = require('crypto').randomUUID();
        // Resolve account_id from code_id if needed
        let accountId: string | null = (it as any).account_id ? String((it as any).account_id) : null;
        if (!accountId && (it as any).code_id) {
          try {
            accountId = await resolveAccountIdFromCodeId(client, String((it as any).code_id));
          } catch (e) {
            return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: String((e as any)?.message || e) });
          }
        }
        if (!accountId) {
          return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: 'Missing account identifier' });
        }
        await client.query(
          `INSERT INTO journal_items (id, journal_id, account_id, party_id, debit, credit, description, detail_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            itemId,
            id,
            accountId,
            null,
            it.debit,
            it.credit,
            it.description ?? null,
            (it as any).detail_id ?? null
          ]
        );
      }
      await client.query('COMMIT');
      return res.status(201).json({ id, status: 'draft', ref_no: nextRef, code: nextCode, serial_no: serialNo, message: t('journals.created', lang) });
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
 * PATCH /:id - Update journal metadata (only in draft).
 * If `ref_no` is provided as an empty string, auto-assign the next number
 * within the same fiscal year.
 */
journalsRouter.patch('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  const parse = journalUpdateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  let { date, code, ref_no, description, items } = parse.data as any;
  try {
    const p = getPool();
    const jr = await p.query(`SELECT status, fiscal_year_id FROM journals WHERE id = $1`, [id]);
    if (jr.rowCount === 0) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
    const status = jr.rows[0].status as string;
    const fiscal_year_id = jr.rows[0].fiscal_year_id as string;
    if (status !== 'draft') return res.status(400).json({ ok: false, error: t('journals.cannotModifyPosted', lang) });

    // Auto-number if ref_no is explicitly blank
    if (typeof ref_no === 'string' && ref_no.trim() === '') {
      const probe = await p.query(
        `SELECT COALESCE(MAX(CAST(ref_no AS INT)), 0) AS max_ref
         FROM journals
         WHERE fiscal_year_id = $1 AND ref_no ~ '^[0-9]+$'`,
        [fiscal_year_id]
      );
      const maxRef = Number(probe.rows[0]?.max_ref || 0);
      ref_no = String(maxRef + 1);
    }

    // Auto-fill code if explicitly blank
    if (typeof code === 'string' && code.trim() === '') {
      const probeCode = await p.query(
        `SELECT COALESCE(MAX(CAST(code AS INT)), 0) AS max_code FROM journals WHERE code ~ '^[0-9]+$'`
      );
      const maxCode = Number(probeCode.rows[0]?.max_code || 0);
      code = String(maxCode + 1);
    }

    // If items provided, validate balance and replace items transactionally
    if (items && Array.isArray(items) && items.length > 0) {
      const totals = computeTotals(items);
      if (Math.abs(totals.debit - totals.credit) > 0.0001) {
        return res.status(400).json({ ok: false, error: t('journals.unbalanced', lang) });
      }
      const client = await p.connect();
      try {
        await client.query('BEGIN');
        const ur = await client.query(
          `UPDATE journals
           SET date = COALESCE($1, date),
               code = COALESCE($2, code),
               ref_no = COALESCE($3, ref_no),
               description = COALESCE($4, description)
           WHERE id = $5 RETURNING id, ref_no, code`,
          [date ?? null, code ?? null, ref_no ?? null, description ?? null, id]
        );
        if (ur.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
        }
        await client.query('DELETE FROM journal_items WHERE journal_id = $1', [id]);
        for (const it of items as any[]) {
          const itemId = require('crypto').randomUUID();
          let accountId: string | null = it.account_id ? String(it.account_id) : null;
          if (!accountId && it.code_id) {
            try {
              accountId = await resolveAccountIdFromCodeId(client, String(it.code_id));
            } catch (e) {
              await client.query('ROLLBACK');
              return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: String((e as any)?.message || e) });
            }
          }
          if (!accountId) {
            await client.query('ROLLBACK');
            return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: 'Missing account identifier' });
          }
          await client.query(
            `INSERT INTO journal_items (id, journal_id, account_id, party_id, debit, credit, description, detail_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              itemId,
              id,
              accountId,
              null,
              it.debit,
              it.credit,
              it.description ?? null,
              it.detail_id ?? null
            ]
          );
        }
        await client.query('COMMIT');
        return res.json({ id, ref_no: ur.rows[0].ref_no, code: ur.rows[0].code, message: t('journals.updated', lang) });
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
             description = COALESCE($4, description)
         WHERE id = $5 RETURNING id, ref_no, code`,
        [date ?? null, code ?? null, ref_no ?? null, description ?? null, id]
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
    const jr = await p.query(`SELECT status FROM journals WHERE id = $1`, [id]);
    if (jr.rowCount === 0) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
    const status = jr.rows[0].status as string;
    if (status !== 'draft') return res.status(400).json({ ok: false, error: t('journals.cannotModifyPosted', lang) });
    const tr = await p.query(`SELECT SUM(debit) AS debit, SUM(credit) AS credit FROM journal_items WHERE journal_id = $1`, [id]);
    const debit = Number(tr.rows[0]?.debit || 0);
    const credit = Number(tr.rows[0]?.credit || 0);
    if (Math.abs(debit - credit) > 0.0001) return res.status(400).json({ ok: false, error: t('journals.unbalanced', lang) });
    await p.query(`UPDATE journals SET status = 'posted' WHERE id = $1`, [id]);
    return res.json({ id, status: 'posted', message: t('journals.posted', lang) });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * DELETE /:id - Delete a journal (only in draft).
 */
journalsRouter.delete('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    const p = getPool();
    const jr = await p.query(`SELECT status FROM journals WHERE id = $1`, [id]);
    if (jr.rowCount === 0) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
    const status = jr.rows[0].status as string;
    if (status !== 'draft') return res.status(400).json({ ok: false, error: t('journals.cannotDeletePosted', lang) });
    const r = await p.query(`DELETE FROM journals WHERE id = $1`, [id]);
    if ((r.rowCount || 0) === 0) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
    return res.json({ id, message: t('journals.deleted', lang) });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST /:id/reverse - Reverse a posted journal by creating a new posted journal
 * with debit/credit swapped per item. Transactional.
 */
journalsRouter.post('/:id/reverse', async (req: Request, res: Response) => {
  // Function: create reversal journal using account_id field
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    const p = getPool();
    const jr = await p.query(`SELECT id, fiscal_year_id, ref_no, date, status, description FROM journals WHERE id = $1`, [id]);
    if (jr.rowCount === 0) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
    const j = jr.rows[0] as any;
    if (String(j.status) !== 'posted') return res.status(400).json({ ok: false, error: t('journals.cannotReverseDraft', lang) });
    const ir = await p.query(`SELECT account_id, party_id, debit, credit, description FROM journal_items WHERE journal_id = $1`, [id]);
    const items = ir.rows as any[];
    const client = await p.connect();
    const newId = require('crypto').randomUUID();
    const newRef = j.ref_no ? `REV-${j.ref_no}` : `REV-${String(id).slice(0, 8)}`;
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO journals (id, fiscal_year_id, ref_no, date, description, status) VALUES ($1, $2, $3, $4, $5, 'posted')`, [
        newId,
        j.fiscal_year_id,
        newRef,
        j.date,
        (j.description ? `Reversal of ${id}: ${j.description}` : `Reversal of ${id}`)
      ]);
      for (const it of items) {
        const itemId = require('crypto').randomUUID();
        await client.query(
          `INSERT INTO journal_items (id, journal_id, account_id, party_id, debit, credit, description) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            itemId,
            newId,
            it.account_id,
            null,
            Number(it.credit || 0),
            Number(it.debit || 0),
            it.description ? `Reversal: ${it.description}` : 'Reversal'
          ]
        );
      }
      await client.query('COMMIT');
      return res.json({ id: newId, status: 'posted', message: t('journals.reversed', lang) });
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
  // Function: generate an automatic New York journal with two items
  const lang: Lang = (req as any).lang || 'en';
  const parse = autoNewYorkSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { fiscal_year_id, date, amount, debit_account_id, credit_account_id, description } = parse.data;
  try {
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');

      // Compute next ref_no within fiscal year
      const probe = await client.query(
        `SELECT COALESCE(MAX(CAST(ref_no AS INT)), 0) AS max_ref
         FROM journals
         WHERE fiscal_year_id = $1 AND ref_no ~ '^[0-9]+$'`,
        [fiscal_year_id]
      );
      const maxRef = Number(probe.rows[0]?.max_ref || 0);
      const nextRef = String(maxRef + 1);

      const id = require('crypto').randomUUID();
      const ins2 = await client.query(
        `INSERT INTO journals (id, fiscal_year_id, ref_no, date, description, status)
         VALUES ($1, $2, $3, $4, $5, 'draft') RETURNING serial_no`,
        [id, fiscal_year_id, nextRef, date, description ?? 'New York automatic journal']
      );
      const serialNo2 = ins2.rows[0]?.serial_no;

      // Insert two items: debit and credit
      const debitItemId = require('crypto').randomUUID();
      await client.query(
        `INSERT INTO journal_items (id, journal_id, account_id, party_id, debit, credit, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          debitItemId,
          id,
          debit_account_id,
          null,
          amount,
          0,
          'NY debit'
        ]
      );

      const creditItemId = require('crypto').randomUUID();
      await client.query(
        `INSERT INTO journal_items (id, journal_id, account_id, party_id, debit, credit, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          creditItemId,
          id,
          credit_account_id,
          null,
          0,
          amount,
          'NY credit'
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
      return res.status(201).json({ id, status: 'draft', ref_no: nextRef, serial_no: serialNo2, message: t('journals.autoNewYorkCreated', lang) });
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
    // Accept single, array, or comma-separated status values (ignored; drafts enforced)
    status: z.union([z.enum(['draft', 'posted']), z.array(z.enum(['draft', 'posted'])), z.string()]).optional(),
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
      statuses = statuses.filter((s) => s === 'draft' || s === 'posted');

      // Always restrict to drafts
      whereClauses.push(`j.status = 'draft'`);

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
        SET status = 'posted'
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