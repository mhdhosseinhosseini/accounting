import express, { Request, Response } from 'express';
import { z } from 'zod';
import { t, Lang } from '../i18n';
import { requireAuth } from '../middleware/auth';
import { getPool } from '../db/pg';
import { getDb } from '../db/sqlite';

/**
 * Router for invoices CRUD and posting logic.
 * - Supports both SQLite and Postgres based on `DB_DRIVER`.
 * - Posting creates a balanced journal (AR vs Sales) and optional inventory transactions.
 */
export const invoicesRouter = express.Router();

// All routes require authentication
invoicesRouter.use(requireAuth);

/** Helper: check if running SQLite driver. */
function usingSqlite() {
  return (process.env.DB_DRIVER || '').toLowerCase() === 'sqlite';
}

/** Zod schema for invoice item input. */
const invoiceItemInputSchema = z.object({
  product_id: z.string().uuid().optional(),
  quantity: z.number().positive(),
  unit_price: z.number().min(0),
});

/** Zod schema for creating an invoice (draft). */
const invoiceCreateSchema = z.object({
  fiscal_year_id: z.string().uuid(),
  customer_id: z.string().uuid().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  invoice_no: z.string().optional(),
  items: z.array(invoiceItemInputSchema).min(1),
});

/** Zod schema for updating an invoice (only when draft). */
const invoiceUpdateSchema = z.object({
  fiscal_year_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  invoice_no: z.string().optional(),
  items: z.array(invoiceItemInputSchema).min(1).optional(),
});

/** Zod schema for posting an invoice. */
const invoicePostSchema = z.object({
  accounts: z.object({
    receivable_account_id: z.string().uuid(),
    sales_account_id: z.string().uuid(),
  }),
  warehouse_id: z.string().uuid().optional(),
});

/** Utility: compute total of invoice items. */
function computeTotal(items: Array<{ quantity: number; unit_price: number }>): number {
  return items.reduce((acc, it) => acc + Number(it.quantity) * Number(it.unit_price), 0);
}

/**
 * GET / - List invoices.
 * Returns basic invoice fields sorted by date desc.
 */
invoicesRouter.get('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    if (usingSqlite()) {
      const d = getDb();
      const items = d.prepare(`SELECT id, invoice_no, fiscal_year_id, customer_id, date, status, total FROM invoices ORDER BY date DESC`).all();
      return res.json({ items, message: t('invoices.list', lang) });
    } else {
      const p = getPool();
      const r = await p.query(`SELECT id, invoice_no, fiscal_year_id, customer_id, date, status, total FROM invoices ORDER BY date DESC`);
      return res.json({ items: r.rows, message: t('invoices.list', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * GET /:id - Fetch an invoice with items.
 */
invoicesRouter.get('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    if (usingSqlite()) {
      const d = getDb();
      const inv = d.prepare(`SELECT id, invoice_no, fiscal_year_id, customer_id, date, status, total FROM invoices WHERE id = ?`).get(id) as any;
      if (!inv) return res.status(404).json({ ok: false, error: t('invoices.notFound', lang) });
      const items = d.prepare(`SELECT id, invoice_id, product_id, quantity, unit_price, total FROM invoice_items WHERE invoice_id = ?`).all(id);
      return res.json({ item: { ...inv, items }, message: t('invoices.fetchOne', lang) });
    } else {
      const p = getPool();
      const r = await p.query(`SELECT id, invoice_no, fiscal_year_id, customer_id, date, status, total FROM invoices WHERE id = $1`, [id]);
      if (r.rowCount === 0) return res.status(404).json({ ok: false, error: t('invoices.notFound', lang) });
      const ir = await p.query(`SELECT id, invoice_id, product_id, quantity, unit_price, total FROM invoice_items WHERE invoice_id = $1`, [id]);
      return res.json({ item: { ...r.rows[0], items: ir.rows }, message: t('invoices.fetchOne', lang) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST / - Create a draft invoice.
 * Validates items and computes totals.
 */
invoicesRouter.post('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const parse = invoiceCreateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { fiscal_year_id, customer_id, date, invoice_no, items } = parse.data;
  const id = require('crypto').randomUUID();
  const total = computeTotal(items);
  try {
    if (usingSqlite()) {
      const d = getDb();
      const tx = d.transaction(() => {
        d.prepare(`INSERT INTO invoices (id, invoice_no, fiscal_year_id, customer_id, date, status, total) VALUES (?, ?, ?, ?, ?, 'draft', ?)`)
          .run(id, invoice_no ?? null, fiscal_year_id ?? null, customer_id ?? null, date, total);
        const ins = d.prepare(`INSERT INTO invoice_items (id, invoice_id, product_id, quantity, unit_price, total) VALUES (?, ?, ?, ?, ?, ?)`);
        for (const it of items) {
          const itemId = require('crypto').randomUUID();
          const lineTotal = Number(it.quantity) * Number(it.unit_price);
          ins.run(itemId, id, it.product_id ?? null, it.quantity, it.unit_price, lineTotal);
        }
      });
      tx();
      return res.status(201).json({ id, status: 'draft', message: t('invoices.created', lang) });
    } else {
      const p = getPool();
      const client = await p.connect();
      try {
        await client.query('BEGIN');
        await client.query(`INSERT INTO invoices (id, invoice_no, fiscal_year_id, customer_id, date, status, total) VALUES ($1, $2, $3, $4, $5, 'draft', $6)`, [id, invoice_no ?? null, fiscal_year_id ?? null, customer_id ?? null, date, total]);
        for (const it of items) {
          const itemId = require('crypto').randomUUID();
          const lineTotal = Number(it.quantity) * Number(it.unit_price);
          await client.query(`INSERT INTO invoice_items (id, invoice_id, product_id, quantity, unit_price, total) VALUES ($1, $2, $3, $4, $5, $6)`, [itemId, id, it.product_id ?? null, it.quantity, it.unit_price, lineTotal]);
        }
        await client.query('COMMIT');
        return res.status(201).json({ id, status: 'draft', message: t('invoices.created', lang) });
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
 * PATCH /:id - Update invoice (only when in draft).
 * Can update header and replace items if provided.
 */
invoicesRouter.patch('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  const parse = invoiceUpdateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { fiscal_year_id, customer_id, date, invoice_no, items } = parse.data;
  try {
    if (usingSqlite()) {
      const d = getDb();
      const inv = d.prepare(`SELECT status FROM invoices WHERE id = ?`).get(id) as any;
      if (!inv) return res.status(404).json({ ok: false, error: t('invoices.notFound', lang) });
      if (inv.status !== 'draft') return res.status(400).json({ ok: false, error: t('invoices.cannotModifyPosted', lang) });
      const tx = d.transaction(() => {
        d.prepare(`UPDATE invoices SET fiscal_year_id = COALESCE(?, fiscal_year_id), customer_id = COALESCE(?, customer_id), date = COALESCE(?, date), invoice_no = COALESCE(?, invoice_no) WHERE id = ?`)
          .run(fiscal_year_id ?? null, customer_id ?? null, date ?? null, invoice_no ?? null, id);
        if (items) {
          d.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).run(id);
          const ins = d.prepare(`INSERT INTO invoice_items (id, invoice_id, product_id, quantity, unit_price, total) VALUES (?, ?, ?, ?, ?, ?)`);
          for (const it of items) {
            const itemId = require('crypto').randomUUID();
            const lineTotal = Number(it.quantity) * Number(it.unit_price);
            ins.run(itemId, id, it.product_id ?? null, it.quantity, it.unit_price, lineTotal);
          }
          const newTotal = computeTotal(items);
          d.prepare(`UPDATE invoices SET total = ? WHERE id = ?`).run(newTotal, id);
        }
      });
      tx();
      return res.json({ id, message: t('invoices.updated', lang) });
    } else {
      const p = getPool();
      const client = await p.connect();
      try {
        const exist = await client.query(`SELECT status FROM invoices WHERE id = $1`, [id]);
        if (exist.rowCount === 0) {
          client.release();
          return res.status(404).json({ ok: false, error: t('invoices.notFound', lang) });
        }
        const status = exist.rows[0].status as string;
        if (status !== 'draft') {
          client.release();
          return res.status(400).json({ ok: false, error: t('invoices.cannotModifyPosted', lang) });
        }
        await client.query('BEGIN');
        await client.query(`UPDATE invoices SET fiscal_year_id = COALESCE($1, fiscal_year_id), customer_id = COALESCE($2, customer_id), date = COALESCE($3, date), invoice_no = COALESCE($4, invoice_no) WHERE id = $5`, [fiscal_year_id ?? null, customer_id ?? null, date ?? null, invoice_no ?? null, id]);
        if (items) {
          await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [id]);
          for (const it of items) {
            const itemId = require('crypto').randomUUID();
            const lineTotal = Number(it.quantity) * Number(it.unit_price);
            await client.query(`INSERT INTO invoice_items (id, invoice_id, product_id, quantity, unit_price, total) VALUES ($1, $2, $3, $4, $5, $6)`, [itemId, id, it.product_id ?? null, it.quantity, it.unit_price, lineTotal]);
          }
          const newTotal = computeTotal(items);
          await client.query(`UPDATE invoices SET total = $1 WHERE id = $2`, [newTotal, id]);
        }
        await client.query('COMMIT');
        return res.json({ id, message: t('invoices.updated', lang) });
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
 * DELETE /:id - Delete invoice if draft.
 */
invoicesRouter.delete('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    if (usingSqlite()) {
      const d = getDb();
      const inv = d.prepare(`SELECT status FROM invoices WHERE id = ?`).get(id) as any;
      if (!inv) return res.status(404).json({ ok: false, error: t('invoices.notFound', lang) });
      if (inv.status !== 'draft') return res.status(400).json({ ok: false, error: t('invoices.cannotDeletePosted', lang) });
      const tx = d.transaction(() => {
        d.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).run(id);
        d.prepare(`DELETE FROM invoices WHERE id = ?`).run(id);
      });
      tx();
      return res.json({ id, message: t('invoices.deleted', lang) });
    } else {
      const p = getPool();
      const client = await p.connect();
      try {
        const exist = await client.query(`SELECT status FROM invoices WHERE id = $1`, [id]);
        if (exist.rowCount === 0) {
          client.release();
          return res.status(404).json({ ok: false, error: t('invoices.notFound', lang) });
        }
        const status = exist.rows[0].status as string;
        if (status !== 'draft') {
          client.release();
          return res.status(400).json({ ok: false, error: t('invoices.cannotDeletePosted', lang) });
        }
        await client.query('BEGIN');
        await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [id]);
        await client.query(`DELETE FROM invoices WHERE id = $1`, [id]);
        await client.query('COMMIT');
        return res.json({ id, message: t('invoices.deleted', lang) });
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
 * POST /:id/post - Post invoice, create journal and inventory transactions.
 */
invoicesRouter.post('/:id/post', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  const parse = invoicePostSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { accounts, warehouse_id } = parse.data;
  try {
    if (usingSqlite()) {
      const d = getDb();
      const inv = d.prepare(`SELECT id, invoice_no, fiscal_year_id, customer_id, date, status FROM invoices WHERE id = ?`).get(id) as any;
      if (!inv) return res.status(404).json({ ok: false, error: t('invoices.notFound', lang) });
      if (inv.status !== 'draft') return res.status(400).json({ ok: false, error: t('invoices.cannotModifyPosted', lang) });
      const items = d.prepare(`SELECT product_id, quantity, unit_price, total FROM invoice_items WHERE invoice_id = ?`).all(id) as any[];
      const total = items.reduce((acc, it) => acc + Number(it.total || 0), 0);

      const tx = d.transaction(() => {
        // Create journal (posted) with 2 lines: DR Receivable, CR Sales
        const journalId = require('crypto').randomUUID();
        d.prepare(`INSERT INTO journals (id, fiscal_year_id, ref_no, date, description, status) VALUES (?, ?, ?, ?, ?, 'posted')`).run(journalId, inv.fiscal_year_id ?? null, inv.invoice_no ?? null, inv.date, `Invoice ${inv.invoice_no || inv.id}`);
        d.prepare(`INSERT INTO journal_items (id, journal_id, account_id, party_id, debit, credit, description) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(require('crypto').randomUUID(), journalId, accounts.receivable_account_id, inv.customer_id ?? null, total, 0, 'Invoice receivable');
        d.prepare(`INSERT INTO journal_items (id, journal_id, account_id, party_id, debit, credit, description) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(require('crypto').randomUUID(), journalId, accounts.sales_account_id, inv.customer_id ?? null, 0, total, 'Invoice sales');
        // Update invoice status
        d.prepare(`UPDATE invoices SET status = 'posted', total = ? WHERE id = ?`).run(total, id);
        // Optional inventory transactions
        if (warehouse_id) {
          const insInv = d.prepare(`INSERT INTO inventory_transactions (id, product_id, warehouse_id, quantity, type, date, reference) VALUES (?, ?, ?, ?, ?, ?, ?)`);
          for (const it of items) {
            if (it.product_id) {
              insInv.run(require('crypto').randomUUID(), it.product_id, warehouse_id, it.quantity, 'out', inv.date, `INV:${inv.invoice_no || inv.id}`);
            }
          }
        }
      });
      tx();
      return res.json({ id, status: 'posted', message: t('invoices.posted', lang) });
    } else {
      const p = getPool();
      const client = await p.connect();
      try {
        const exist = await client.query(`SELECT id, invoice_no, fiscal_year_id, customer_id, date, status FROM invoices WHERE id = $1`, [id]);
        if (exist.rowCount === 0) {
          client.release();
          return res.status(404).json({ ok: false, error: t('invoices.notFound', lang) });
        }
        const inv = exist.rows[0] as any;
        if (inv.status !== 'draft') {
          client.release();
          return res.status(400).json({ ok: false, error: t('invoices.cannotModifyPosted', lang) });
        }
        const ir = await client.query(`SELECT product_id, quantity, unit_price, total FROM invoice_items WHERE invoice_id = $1`, [id]);
        const items = ir.rows as any[];
        const total = items.reduce((acc, it) => acc + Number(it.total || 0), 0);

        await client.query('BEGIN');
        const journalId = require('crypto').randomUUID();
        await client.query(`INSERT INTO journals (id, fiscal_year_id, ref_no, date, description, status) VALUES ($1, $2, $3, $4, $5, 'posted')`, [journalId, inv.fiscal_year_id ?? null, inv.invoice_no ?? null, inv.date, `Invoice ${inv.invoice_no || inv.id}`]);
        await client.query(`INSERT INTO journal_items (id, journal_id, account_id, party_id, debit, credit, description) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [require('crypto').randomUUID(), journalId, accounts.receivable_account_id, inv.customer_id ?? null, total, 0, 'Invoice receivable']);
        await client.query(`INSERT INTO journal_items (id, journal_id, account_id, party_id, debit, credit, description) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [require('crypto').randomUUID(), journalId, accounts.sales_account_id, inv.customer_id ?? null, 0, total, 'Invoice sales']);
        await client.query(`UPDATE invoices SET status = 'posted', total = $1 WHERE id = $2`, [total, id]);
        if (warehouse_id) {
          for (const it of items) {
            if (it.product_id) {
              await client.query(`INSERT INTO inventory_transactions (id, product_id, warehouse_id, quantity, type, date, reference) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [require('crypto').randomUUID(), it.product_id, warehouse_id, it.quantity, 'out', inv.date, `INV:${inv.invoice_no || inv.id}`]);
            }
          }
        }
        await client.query('COMMIT');
        return res.json({ id, status: 'posted', message: t('invoices.posted', lang) });
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