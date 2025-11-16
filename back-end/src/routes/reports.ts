import express, { Request, Response } from 'express';
import { t, Lang } from '../i18n';
import { requireAuth } from '../middleware/auth';
import { getPool } from '../db/pg';

/**
 * Reports Router
 * Provides: Trial Balance, Ledger, Balance Sheet, Profit & Loss
 * Postgres-only implementation.
 */
export const reportsRouter = express.Router();

// Authentication middleware for all report endpoints
reportsRouter.use(requireAuth);

/**
 * GET /trial-balance
 * Compute per-account debit/credit totals for a given fiscal year (posted journals only).
 * Query: fiscal_year_id (required)
 */
reportsRouter.get('/trial-balance', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const fiscal_year_id = String(req.query.fiscal_year_id || '');
  if (!fiscal_year_id) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang) });
  try {
    const p = getPool();
    const r = await p.query(
      `SELECT a.id as account_id, a.code, a.name, a.type,
              COALESCE(SUM(ji.debit), 0) as debit,
              COALESCE(SUM(ji.credit), 0) as credit
       FROM journal_items ji
       JOIN journals j ON j.id = ji.journal_id
       JOIN accounts a ON a.id = ji.account_id
       WHERE j.status = 'posted' AND j.fiscal_year_id = $1
       GROUP BY a.id, a.code, a.name, a.type
       ORDER BY a.code`,
      [fiscal_year_id]
    );
    const items = r.rows as any[];
    const totals = items.reduce(
      (acc: any, row: any) => {
        acc.debit += Number(row.debit || 0);
        acc.credit += Number(row.credit || 0);
        return acc;
      },
      { debit: 0, credit: 0 }
    );
    return res.json({ items, totals, message: t('reports.trialBalance.fetched', lang) });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * GET /ledger
 * Return journal entries for a specific account in a fiscal year, optional date range.
 * Query: fiscal_year_id (required), account_id (required), start_date (optional), end_date (optional)
 */
reportsRouter.get('/ledger', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const fiscal_year_id = String(req.query.fiscal_year_id || '');
  const account_id = String(req.query.account_id || '');
  const start_date = req.query.start_date ? String(req.query.start_date) : null;
  const end_date = req.query.end_date ? String(req.query.end_date) : null;
  if (!fiscal_year_id || !account_id) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang) });
  try {
    const p = getPool();
    let sql = `SELECT j.id as journal_id, j.date, j.ref_no, ji.id as item_id, ji.debit, ji.credit, ji.description
               FROM journal_items ji
               JOIN journals j ON j.id = ji.journal_id
               WHERE j.status = 'posted' AND j.fiscal_year_id = $1 AND ji.account_id = $2`;
    const params: any[] = [fiscal_year_id, account_id];
    if (start_date && end_date) {
      sql += ` AND j.date BETWEEN $3 AND $4`;
      params.push(start_date, end_date);
    }
    sql += ` ORDER BY j.date ASC, j.ref_no ASC`;
    const r = await p.query(sql, params);
    return res.json({ items: r.rows, message: t('reports.ledger.fetched', lang) });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * GET /balance-sheet
 * Compute balance sheet summary by account type for a fiscal year.
 * Includes retained earnings from (revenue - expense) to equity.
 * Query: fiscal_year_id (required)
 */
reportsRouter.get('/balance-sheet', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const fiscal_year_id = String(req.query.fiscal_year_id || '');
  if (!fiscal_year_id) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang) });
  try {
    const baseSql = `SELECT a.type, COALESCE(SUM(ji.debit), 0) as debit, COALESCE(SUM(ji.credit), 0) as credit
                     FROM journal_items ji
                     JOIN journals j ON j.id = ji.journal_id
                     JOIN accounts a ON a.id = ji.account_id
                     WHERE j.status = 'posted' AND j.fiscal_year_id = $1
                     GROUP BY a.type`;
    const p = getPool();
    const r = await p.query(baseSql, [fiscal_year_id]);
    const rows = r.rows as any[];
    const sums: Record<string, { debit: number; credit: number }> = {};
    for (const rr of rows) {
      const type = String(rr.type);
      sums[type] = sums[type] || { debit: 0, credit: 0 };
      sums[type].debit += Number(rr.debit || 0);
      sums[type].credit += Number(rr.credit || 0);
    }
    const assetNet = (sums['asset']?.debit || 0) - (sums['asset']?.credit || 0);
    const liabilityNet = (sums['liability']?.credit || 0) - (sums['liability']?.debit || 0);
    const equityNet = (sums['equity']?.credit || 0) - (sums['equity']?.debit || 0);
    const revenueNet = (sums['revenue']?.credit || 0) - (sums['revenue']?.debit || 0);
    const expenseNet = (sums['expense']?.debit || 0) - (sums['expense']?.credit || 0);
    const retainedEarnings = revenueNet - expenseNet;
    const liabilitiesPlusEquity = liabilityNet + equityNet + retainedEarnings;
    return res.json({
      summary: {
        assets: assetNet,
        liabilities: liabilityNet,
        equity: equityNet,
        retained_earnings: retainedEarnings,
        liabilities_plus_equity: liabilitiesPlusEquity,
      },
      message: t('reports.balanceSheet.fetched', lang),
    });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * GET /profit-loss
 * Compute profit & loss summary for a fiscal year: revenue, expense, profit.
 * Query: fiscal_year_id (required)
 */
reportsRouter.get('/profit-loss', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const fiscal_year_id = String(req.query.fiscal_year_id || '');
  if (!fiscal_year_id) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang) });
  try {
    const baseSql = `SELECT a.type, COALESCE(SUM(ji.debit), 0) as debit, COALESCE(SUM(ji.credit), 0) as credit
                     FROM journal_items ji
                     JOIN journals j ON j.id = ji.journal_id
                     JOIN accounts a ON a.id = ji.account_id
                     WHERE j.status = 'posted' AND j.fiscal_year_id = $1
                     GROUP BY a.type`;
    const p = getPool();
    const r = await p.query(baseSql, [fiscal_year_id]);
    const rows = r.rows as any[];
    const sums: Record<string, { debit: number; credit: number }> = {};
    for (const rr of rows) {
      const type = String(rr.type);
      sums[type] = sums[type] || { debit: 0, credit: 0 };
      sums[type].debit += Number(rr.debit || 0);
      sums[type].credit += Number(rr.credit || 0);
    }
    const totalRevenue = (sums['revenue']?.credit || 0) - (sums['revenue']?.debit || 0);
    const totalExpense = (sums['expense']?.debit || 0) - (sums['expense']?.credit || 0);
    const profit = totalRevenue - totalExpense;
    return res.json({ summary: { revenue: totalRevenue, expense: totalExpense, profit }, message: t('reports.profitLoss.fetched', lang) });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});