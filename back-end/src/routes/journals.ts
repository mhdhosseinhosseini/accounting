import express, { Request, Response } from 'express';
import { z } from 'zod';
import { t, Lang } from '../i18n';
import { requireAuth } from '../middleware/auth';
import { getPool } from '../db/pg';
import { getDb } from '../db/sqlite';

/**
 * Router for journal operations (list/get/create/update/delete/post) with items.
 * Supports Postgres and SQLite using env `DB_DRIVER` to select driver.
 */
export const journalsRouter = express.Router();

// All routes require authentication
journalsRouter.use(requireAuth);

/** Helper to check if running with SQLite driver. */
function usingSqlite() {
  return (process.env.DB_DRIVER || '').toLowerCase() === 'sqlite';
}

/** Zod schema for journal item input. */
const journalItemSchema = z.object({
  account_id: z.string().uuid(),
  party_id: z.string().uuid().optional().nullable(),
  debit: z.number().min(0),
  credit: z.number().min(0),
  description: z.string().optional()
}).refine((it) => !(it.debit > 0 && it.credit > 0), {
  message: 'Item cannot have both debit and credit',
  path: ['debit']
});

/** Zod schema for journal creation. */
const journalCreateSchema = z.object({
  fiscal_year_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ref_no: z.string().optional(),
  description: z.string().optional(),
  items: z.array(journalItemSchema).min(1)
});

/** Zod schema for journal update (metadata only). */
const journalUpdateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ref_no: z.string().optional(),
  description: z.string().optional()
});

/**
 * Utility: compute total debit and credit for items.
 * Returns { debit, credit } as numbers.
 */
function computeTotals(items: Array<{ debit: number; credit: number }>): { debit: number; credit: number } {
  return items.reduce((acc, it) => ({ debit: acc.debit + Number(it.debit || 0), credit: acc.credit + Number(it.credit || 0) }), { debit: 0, credit: 0 });
}

/**
 * GET / - List journals.
 * Returns basic journal fields sorted by date desc.
 */
journalsRouter.get('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    if (usingSqlite()) {
      const d = getDb();
      const items = d.prepare(`SELECT id, fiscal_year_id, ref_no, date, description, status FROM journals ORDER BY date DESC`).all();
      return res.json({ items, message: t('journals.list', lang) });
    } else {
      const p = getPool();
      const r = await p.query(`SELECT id, fiscal_year_id, ref_no, date, description, status FROM journals ORDER BY date DESC`);
      return res.json({ items: r.rows, message: t('journals.list', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * GET /:id - Fetch a journal with its items.
 */
journalsRouter.get('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    if (usingSqlite()) {
      const d = getDb();
      const j = d.prepare(`SELECT id, fiscal_year_id, ref_no, date, description, status FROM journals WHERE id = ?`).get(id);
      if (!j) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
      const items = d.prepare(`SELECT id, journal_id, account_id, party_id, debit, credit, description FROM journal_items WHERE journal_id = ?`).all(id);
      return res.json({ item: { ...j, items }, message: t('journals.fetchOne', lang) });
    } else {
      const p = getPool();
      const jr = await p.query(`SELECT id, fiscal_year_id, ref_no, date, description, status FROM journals WHERE id = $1`, [id]);
      if (jr.rowCount === 0) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
      const ir = await p.query(`SELECT id, journal_id, account_id, party_id, debit, credit, description FROM journal_items WHERE journal_id = $1`, [id]);
      return res.json({ item: { ...jr.rows[0], items: ir.rows }, message: t('journals.fetchOne', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST / - Create a draft journal with items.
 * Validates double-entry balance before persistence.
 */
journalsRouter.post('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const parse = journalCreateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { fiscal_year_id, date, ref_no, description, items } = parse.data;
  const totals = computeTotals(items);
  if (Math.abs(totals.debit - totals.credit) > 0.0001) return res.status(400).json({ ok: false, error: t('journals.unbalanced', lang) });
  const id = require('crypto').randomUUID();
  try {
    if (usingSqlite()) {
      const d = getDb();
      const tx = d.transaction(() => {
        d.prepare(`INSERT INTO journals (id, fiscal_year_id, ref_no, date, description, status) VALUES (?, ?, ?, ?, ?, 'draft')`).run(id, fiscal_year_id, ref_no ?? null, date, description ?? null);
        const ins = d.prepare(`INSERT INTO journal_items (id, journal_id, account_id, party_id, debit, credit, description) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        for (const it of items) {
          const itemId = require('crypto').randomUUID();
          ins.run(itemId, id, it.account_id, it.party_id ?? null, it.debit, it.credit, it.description ?? null);
        }
      });
      tx();
      return res.status(201).json({ id, status: 'draft', message: t('journals.created', lang) });
    } else {
      const p = getPool();
      const client = await p.connect();
      try {
        await client.query('BEGIN');
        await client.query(`INSERT INTO journals (id, fiscal_year_id, ref_no, date, description, status) VALUES ($1, $2, $3, $4, $5, 'draft')`, [id, fiscal_year_id, ref_no ?? null, date, description ?? null]);
        for (const it of items) {
          const itemId = require('crypto').randomUUID();
          await client.query(`INSERT INTO journal_items (id, journal_id, account_id, party_id, debit, credit, description) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [itemId, id, it.account_id, it.party_id ?? null, it.debit, it.credit, it.description ?? null]);
        }
        await client.query('COMMIT');
        return res.status(201).json({ id, status: 'draft', message: t('journals.created', lang) });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * PATCH /:id - Update journal metadata (only in draft).
 */
journalsRouter.patch('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  const parse = journalUpdateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { date, ref_no, description } = parse.data;
  try {
    if (usingSqlite()) {
      const d = getDb();
      const j = d.prepare(`SELECT status FROM journals WHERE id = ?`).get(id) as any;
      if (!j) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
      if (j.status !== 'draft') return res.status(400).json({ ok: false, error: t('journals.cannotModifyPosted', lang) });
      d.prepare(`UPDATE journals SET date = COALESCE(?, date), ref_no = COALESCE(?, ref_no), description = COALESCE(?, description) WHERE id = ?`).run(date ?? null, ref_no ?? null, description ?? null, id);
      return res.json({ id, message: t('journals.updated', lang) });
    } else {
      const p = getPool();
      const jr = await p.query(`SELECT status FROM journals WHERE id = $1`, [id]);
      if (jr.rowCount === 0) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
      const status = jr.rows[0].status as string;
      if (status !== 'draft') return res.status(400).json({ ok: false, error: t('journals.cannotModifyPosted', lang) });
      const ur = await p.query(`UPDATE journals SET date = COALESCE($1, date), ref_no = COALESCE($2, ref_no), description = COALESCE($3, description) WHERE id = $4 RETURNING id`, [date ?? null, ref_no ?? null, description ?? null, id]);
      if (ur.rowCount === 0) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
      return res.json({ id, message: t('journals.updated', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST /:id/post - Post a journal (validates balance).
 */
journalsRouter.post('/:id/post', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    if (usingSqlite()) {
      const d = getDb();
      const j = d.prepare(`SELECT status FROM journals WHERE id = ?`).get(id) as any;
      if (!j) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
      if (j.status !== 'draft') return res.status(400).json({ ok: false, error: t('journals.cannotModifyPosted', lang) });
      const totals = (d.prepare(`SELECT SUM(debit) AS debit, SUM(credit) AS credit FROM journal_items WHERE journal_id = ?`).get(id) as any) || { debit: 0, credit: 0 };
      const debit = Number(totals.debit || 0);
      const credit = Number(totals.credit || 0);
      if (Math.abs(debit - credit) > 0.0001) return res.status(400).json({ ok: false, error: t('journals.unbalanced', lang) });
      d.prepare(`UPDATE journals SET status = 'posted' WHERE id = ?`).run(id);
      return res.json({ id, status: 'posted', message: t('journals.posted', lang) });
    } else {
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
    }
  } catch (e) {
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
    if (usingSqlite()) {
      const d = getDb();
      const j = d.prepare(`SELECT status FROM journals WHERE id = ?`).get(id) as any;
      if (!j) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
      if (j.status !== 'draft') return res.status(400).json({ ok: false, error: t('journals.cannotDeletePosted', lang) });
      const tx = d.transaction(() => {
        d.prepare(`DELETE FROM journal_items WHERE journal_id = ?`).run(id);
        d.prepare(`DELETE FROM journals WHERE id = ?`).run(id);
      });
      tx();
      return res.json({ id, message: t('journals.deleted', lang) });
    } else {
      const p = getPool();
      const jr = await p.query(`SELECT status FROM journals WHERE id = $1`, [id]);
      if (jr.rowCount === 0) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
      const status = jr.rows[0].status as string;
      if (status !== 'draft') return res.status(400).json({ ok: false, error: t('journals.cannotDeletePosted', lang) });
      const r = await p.query(`DELETE FROM journals WHERE id = $1`, [id]);
      if ((r.rowCount || 0) === 0) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
      return res.json({ id, message: t('journals.deleted', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST /:id/reverse - Reverse a posted journal by creating a new posted journal
 * with debit/credit swapped per item. Operates transactionally and supports
 * both Postgres and SQLite drivers.
 */
journalsRouter.post('/:id/reverse', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    if (usingSqlite()) {
      const d = getDb();
      const j = d.prepare(`SELECT id, fiscal_year_id, ref_no, date, status FROM journals WHERE id = ?`).get(id) as any;
      if (!j) return res.status(404).json({ ok: false, error: t('journals.notFound', lang) });
      if (String(j.status) !== 'posted') return res.status(400).json({ ok: false, error: t('journals.cannotReverseDraft', lang) });
      const items = d.prepare(`SELECT account_id, party_id, debit, credit, description FROM journal_items WHERE journal_id = ?`).all(id) as any[];
      const newId = require('crypto').randomUUID();
      const newRef = j.ref_no ? `REV-${j.ref_no}` : `REV-${String(id).slice(0, 8)}`;
      const tx = d.transaction(() => {
        d.prepare(`INSERT INTO journals (id, fiscal_year_id, ref_no, date, description, status) VALUES (?, ?, ?, ?, ?, 'posted')`).run(
          newId,
          j.fiscal_year_id,
          newRef,
          j.date,
          (j.description ? `Reversal of ${id}: ${j.description}` : `Reversal of ${id}`)
        );
        const ins = d.prepare(`INSERT INTO journal_items (id, journal_id, account_id, party_id, debit, credit, description) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        for (const it of items) {
          const itemId = require('crypto').randomUUID();
          ins.run(
            itemId,
            newId,
            it.account_id,
            it.party_id ?? null,
            Number(it.credit || 0),
            Number(it.debit || 0),
            it.description ? `Reversal: ${it.description}` : 'Reversal'
          );
        }
      });
      tx();
      return res.json({ id: newId, status: 'posted', message: t('journals.reversed', lang) });
    } else {
      const p = getPool();
      const jr = await p.query(`SELECT id, fiscal_year_id, ref_no, date, status FROM journals WHERE id = $1`, [id]);
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
              it.party_id ?? null,
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
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});