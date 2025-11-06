import express, { Request, Response } from 'express';
import { t, Lang } from '../i18n';
import { requireAuth } from '../middleware/auth';
import { getPool } from '../db/pg';
import { getDb } from '../db/sqlite';

/**
 * Reports Router
 * Provides: Trial Balance, Ledger, Balance Sheet, Profit & Loss
 * Supports both SQLite and PostgreSQL based on DB_DRIVER.
 */
export const reportsRouter = express.Router();

// Authentication middleware for all report endpoints
reportsRouter.use(requireAuth);

/** Helper: check if using SQLite driver. */
function usingSqlite() {
  return (process.env.DB_DRIVER || '').toLowerCase() === 'sqlite';
}

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
    if (usingSqlite()) {
      const d = getDb();
      const items = d
        .prepare(
          `SELECT a.id as account_id, a.code, a.name, a.type, 
                  COALESCE(SUM(ji.debit), 0) as debit, 
                  COALESCE(SUM(ji.credit), 0) as credit
           FROM journal_items ji
           JOIN journals j ON j.id = ji.journal_id
           JOIN accounts a ON a.id = ji.account_id
           WHERE j.status = 'posted' AND j.fiscal_year_id = ?
           GROUP BY a.id, a.code, a.name, a.type
           ORDER BY a.code`
        )
        .all(fiscal_year_id);
      const totals = items.reduce(
        (acc: any, r: any) => {
          acc.debit += Number(r.debit || 0);
          acc.credit += Number(r.credit || 0);
          return acc;
        },
        { debit: 0, credit: 0 }
      );
      return res.json({ items, totals, message: t('reports.trialBalance.fetched', lang) });
    } else {
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
    }
  } catch (e) {
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
    if (usingSqlite()) {
      const d = getDb();
      let sql = `SELECT j.id as journal_id, j.date, j.ref_no, ji.id as item_id, ji.debit, ji.credit, ji.description
                 FROM journal_items ji
                 JOIN journals j ON j.id = ji.journal_id
                 WHERE j.status = 'posted' AND j.fiscal_year_id = ? AND ji.account_id = ?`;
      const params: any[] = [fiscal_year_id, account_id];
      if (start_date && end_date) {
        sql += ` AND j.date BETWEEN ? AND ?`;
        params.push(start_date, end_date);
      }
      sql += ` ORDER BY j.date ASC, j.ref_no ASC`;
      const items = d.prepare(sql).all(...params);
      return res.json({ items, message: t('reports.ledger.fetched', lang) });
    } else {
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
    }
  } catch (e) {
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
                     WHERE j.status = 'posted' AND j.fiscal_year_id = %PARAM%
                     GROUP BY a.type`;
    let rows: any[] = [];
    if (usingSqlite()) {
      const d = getDb();
      rows = d.prepare(baseSql.replace('%PARAM%', '?')).all(fiscal_year_id) as any[];
    } else {
      const p = getPool();
      const r = await p.query(baseSql.replace('%PARAM%', '$1'), [fiscal_year_id]);
      rows = r.rows as any[];
    }
    const sums: Record<string, { debit: number; credit: number }> = {};
    for (const r of rows) {
      const type = String(r.type);
      sums[type] = sums[type] || { debit: 0, credit: 0 };
      sums[type].debit += Number(r.debit || 0);
      sums[type].credit += Number(r.credit || 0);
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
  } catch (e) {
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
                     WHERE j.status = 'posted' AND j.fiscal_year_id = %PARAM%
                     GROUP BY a.type`;
    let rows: any[] = [];
    if (usingSqlite()) {
      const d = getDb();
      rows = d.prepare(baseSql.replace('%PARAM%', '?')).all(fiscal_year_id) as any[];
    } else {
      const p = getPool();
      const r = await p.query(baseSql.replace('%PARAM%', '$1'), [fiscal_year_id]);
      rows = r.rows as any[];
    }
    const sums: Record<string, { debit: number; credit: number }> = {};
    for (const r of rows) {
      const type = String(r.type);
      sums[type] = sums[type] || { debit: 0, credit: 0 };
      sums[type].debit += Number(r.debit || 0);
      sums[type].credit += Number(r.credit || 0);
    }
    const totalRevenue = (sums['revenue']?.credit || 0) - (sums['revenue']?.debit || 0);
    const totalExpense = (sums['expense']?.debit || 0) - (sums['expense']?.credit || 0);
    const profit = totalRevenue - totalExpense;
    return res.json({ summary: { revenue: totalRevenue, expense: totalExpense, profit }, message: t('reports.profitLoss.fetched', lang) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});