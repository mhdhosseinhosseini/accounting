import express, { Request, Response } from 'express';
import { z } from 'zod';
import { t, Lang } from '../i18n';
import { requireAuth } from '../middleware/auth';
import { getPool } from '../db/pg';

/**
 * Router for invoices CRUD and posting logic.
 * Postgres-only implementation.
 */
export const invoicesRouter = express.Router();

// All routes require authentication
invoicesRouter.use(requireAuth);

/** Zod schema for invoice item input. */
const invoiceItemInputSchema = z.object({
  product_id: z.string().uuid().optional(),
  quantity: z.number().positive(),
  unit_price: z.number().min(0),
});

/** Zod schema for creating an invoice (temporary). */
const invoiceCreateSchema = z.object({
  fiscal_year_id: z.string().uuid(),
  customer_id: z.string().uuid().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  invoice_no: z.string().optional(),
  items: z.array(invoiceItemInputSchema).min(1),
});

/** Zod schema for updating an invoice (only when temporary). */
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
    // Postgres-only list implementation
    const p = getPool();
    const r = await p.query(`SELECT id, invoice_no, fiscal_year_id, customer_id, date, status, total FROM invoices ORDER BY date DESC`);
    return res.json({ items: r.rows, message: t('invoices.list', lang) });
  } catch {
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
    // Postgres-only fetch-one implementation
    const p = getPool();
    const r = await p.query(`SELECT id, invoice_no, fiscal_year_id, customer_id, date, status, total FROM invoices WHERE id = $1`, [id]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: t('invoices.notFound', lang) });
    const ir = await p.query(`SELECT id, invoice_id, product_id, quantity, unit_price, total FROM invoice_items WHERE invoice_id = $1`, [id]);
    return res.json({ item: { ...r.rows[0], items: ir.rows }, message: t('invoices.fetchOne', lang) });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST / - Create a temporary invoice.
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
    // Postgres-only create implementation
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO invoices (id, invoice_no, fiscal_year_id, customer_id, date, status, total) VALUES ($1, $2, $3, $4, $5, 'temporary', $6)`, [id, invoice_no ?? null, fiscal_year_id ?? null, customer_id ?? null, date, total]);
      for (const it of items) {
        const itemId = require('crypto').randomUUID();
        const lineTotal = Number(it.quantity) * Number(it.unit_price);
        await client.query(`INSERT INTO invoice_items (id, invoice_id, product_id, quantity, unit_price, total) VALUES ($1, $2, $3, $4, $5, $6)`, [itemId, id, it.product_id ?? null, it.quantity, it.unit_price, lineTotal]);
      }
      await client.query('COMMIT');
      return res.status(201).json({ id, status: 'temporary', message: t('invoices.created', lang) });
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
 * PATCH /:id - Update invoice (only when in temporary).
 * Can update header and replace items if provided.
 */
invoicesRouter.patch('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  const parse = invoiceUpdateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { fiscal_year_id, customer_id, date, invoice_no, items } = parse.data;
  try {
    // Postgres-only update implementation
    const p = getPool();
    const client = await p.connect();
    try {
      const exist = await client.query(`SELECT status FROM invoices WHERE id = $1`, [id]);
      if (exist.rowCount === 0) {
        client.release();
        return res.status(404).json({ ok: false, error: t('invoices.notFound', lang) });
      }
      const status = exist.rows[0].status as string;
      if (status !== 'temporary') {
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
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * DELETE /:id - Delete invoice if temporary.
 */
invoicesRouter.delete('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    // Postgres-only delete implementation
    const p = getPool();
    const client = await p.connect();
    try {
      const exist = await client.query(`SELECT status FROM invoices WHERE id = $1`, [id]);
      if (exist.rowCount === 0) {
        client.release();
        return res.status(404).json({ ok: false, error: t('invoices.notFound', lang) });
      }
      const status = exist.rows[0].status as string;
      if (status !== 'temporary') {
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
  } catch {
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
    // Postgres-only post implementation
    const p = getPool();
    const client = await p.connect();
    try {
      const exist = await client.query(`SELECT id, invoice_no, fiscal_year_id, customer_id, date, status FROM invoices WHERE id = $1`, [id]);
      if (exist.rowCount === 0) {
        client.release();
        return res.status(404).json({ ok: false, error: t('invoices.notFound', lang) });
      }
      const inv = exist.rows[0] as any;
      if (inv.status !== 'temporary') {
        client.release();
        return res.status(400).json({ ok: false, error: t('invoices.cannotModifyPosted', lang) });
      }
      const ir = await client.query(`SELECT product_id, quantity, unit_price, total FROM invoice_items WHERE invoice_id = $1`, [id]);
      const items = ir.rows as any[];
      const total = items.reduce((acc, it) => acc + Number(it.total || 0), 0);

      await client.query('BEGIN');
      // Create journal (permanent) with 2 lines: DR Receivable, CR Sales
      const journalId = require('crypto').randomUUID();
      await client.query(`INSERT INTO journals (id, fiscal_year_id, ref_no, date, description, status) VALUES ($1, $2, $3, $4, $5, 'permanent')`, [journalId, inv.fiscal_year_id ?? null, inv.invoice_no ?? null, inv.date, `Invoice ${inv.invoice_no || inv.id}`]);
      await client.query(`INSERT INTO journal_items (id, journal_id, account_id, party_id, debit, credit, description) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [require('crypto').randomUUID(), journalId, accounts.receivable_account_id, inv.customer_id ?? null, total, 0, 'Invoice receivable']);
      await client.query(`INSERT INTO journal_items (id, journal_id, account_id, party_id, debit, credit, description) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [require('crypto').randomUUID(), journalId, accounts.sales_account_id, inv.customer_id ?? null, 0, total, 'Invoice sales']);
      // Update invoice status
      await client.query(`UPDATE invoices SET status = 'permanent', total = $1 WHERE id = $2`, [total, id]);
      // Optional inventory transactions
      if (warehouse_id) {
        for (const it of items) {
          if (it.product_id) {
            await client.query(`INSERT INTO inventory_transactions (id, product_id, warehouse_id, quantity, type, date, reference) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [require('crypto').randomUUID(), it.product_id, warehouse_id, it.quantity, 'out', inv.date, `INV:${inv.invoice_no || inv.id}`]);
          }
        }
      }
      await client.query('COMMIT');
      return res.json({ id, status: 'permanent', message: t('invoices.posted', lang) });
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