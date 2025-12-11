"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportsRouter = void 0;
const express_1 = __importDefault(require("express"));
const i18n_1 = require("../i18n");
const auth_1 = require("../middleware/auth");
const pg_1 = require("../db/pg");
/**
 * Reports Router
 * Provides: Trial Balance, Ledger, Balance Sheet, Profit & Loss
 * Postgres-only implementation.
 */
exports.reportsRouter = express_1.default.Router();
// Authentication middleware for all report endpoints
exports.reportsRouter.use(auth_1.requireAuth);
/**
 * GET /trial-balance
 * Compute per-account debit/credit totals for a given fiscal year (permanent journals only).
 * Query: fiscal_year_id (required)
 */
exports.reportsRouter.get('/trial-balance', async (req, res) => {
    const lang = req.lang || 'en';
    const fiscal_year_id = String(req.query.fiscal_year_id || '');
    if (!fiscal_year_id)
        return res.status(400).json({ ok: false, error: (0, i18n_1.t)('error.invalidInput', lang) });
    try {
        const p = (0, pg_1.getPool)();
        const r = await p.query(`SELECT a.id as account_id, a.code, a.name, a.type,
              COALESCE(SUM(ji.debit), 0) as debit,
              COALESCE(SUM(ji.credit), 0) as credit
       FROM journal_items ji
       JOIN journals j ON j.id = ji.journal_id
       JOIN accounts a ON a.id = ji.account_id
       WHERE j.status = 'permanent' AND j.fiscal_year_id = $1
       GROUP BY a.id, a.code, a.name, a.type
       ORDER BY a.code`, [fiscal_year_id]);
        const items = r.rows;
        const totals = items.reduce((acc, row) => {
            acc.debit += Number(row.debit || 0);
            acc.credit += Number(row.credit || 0);
            return acc;
        }, { debit: 0, credit: 0 });
        return res.json({ items, totals, message: (0, i18n_1.t)('reports.trialBalance.fetched', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * GET /ledger
 * Return journal entries for a specific account in a fiscal year, optional date range.
 * Query: fiscal_year_id (required), account_id (required), start_date (optional), end_date (optional)
 */
exports.reportsRouter.get('/ledger', async (req, res) => {
    const lang = req.lang || 'en';
    const fiscal_year_id = String(req.query.fiscal_year_id || '');
    const account_id = String(req.query.account_id || '');
    const start_date = req.query.start_date ? String(req.query.start_date) : null;
    const end_date = req.query.end_date ? String(req.query.end_date) : null;
    if (!fiscal_year_id || !account_id)
        return res.status(400).json({ ok: false, error: (0, i18n_1.t)('error.invalidInput', lang) });
    try {
        const p = (0, pg_1.getPool)();
        let sql = `SELECT j.id as journal_id, j.date, j.ref_no, ji.id as item_id, ji.debit, ji.credit, ji.description
               FROM journal_items ji
               JOIN journals j ON j.id = ji.journal_id
               WHERE j.status = 'permanent' AND j.fiscal_year_id = $1 AND ji.account_id = $2`;
        const params = [fiscal_year_id, account_id];
        if (start_date && end_date) {
            sql += ` AND j.date BETWEEN $3 AND $4`;
            params.push(start_date, end_date);
        }
        sql += ` ORDER BY j.date ASC, j.ref_no ASC`;
        const r = await p.query(sql, params);
        return res.json({ items: r.rows, message: (0, i18n_1.t)('reports.ledger.fetched', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * GET /balance-sheet
 * Compute balance sheet summary by account type for a fiscal year.
 * Includes retained earnings from (revenue - expense) to equity.
 * Query: fiscal_year_id (required)
 */
exports.reportsRouter.get('/balance-sheet', async (req, res) => {
    const lang = req.lang || 'en';
    const fiscal_year_id = String(req.query.fiscal_year_id || '');
    if (!fiscal_year_id)
        return res.status(400).json({ ok: false, error: (0, i18n_1.t)('error.invalidInput', lang) });
    try {
        const baseSql = `SELECT a.type, COALESCE(SUM(ji.debit), 0) as debit, COALESCE(SUM(ji.credit), 0) as credit
                     FROM journal_items ji
                     JOIN journals j ON j.id = ji.journal_id
                     JOIN accounts a ON a.id = ji.account_id
                     WHERE j.status = 'permanent' AND j.fiscal_year_id = $1
                     GROUP BY a.type`;
        const p = (0, pg_1.getPool)();
        const r = await p.query(baseSql, [fiscal_year_id]);
        const rows = r.rows;
        const sums = {};
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
            message: (0, i18n_1.t)('reports.balanceSheet.fetched', lang),
        });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * GET /profit-loss
 * Compute profit & loss summary for a fiscal year: revenue, expense, profit.
 * Query: fiscal_year_id (required)
 */
exports.reportsRouter.get('/profit-loss', async (req, res) => {
    const lang = req.lang || 'en';
    const fiscal_year_id = String(req.query.fiscal_year_id || '');
    if (!fiscal_year_id)
        return res.status(400).json({ ok: false, error: (0, i18n_1.t)('error.invalidInput', lang) });
    try {
        const baseSql = `SELECT a.type, COALESCE(SUM(ji.debit), 0) as debit, COALESCE(SUM(ji.credit), 0) as credit
                     FROM journal_items ji
                     JOIN journals j ON j.id = ji.journal_id
                     JOIN accounts a ON a.id = ji.account_id
                     WHERE j.status = 'permanent' AND j.fiscal_year_id = $1
                     GROUP BY a.type`;
        const p = (0, pg_1.getPool)();
        const r = await p.query(baseSql, [fiscal_year_id]);
        const rows = r.rows;
        const sums = {};
        for (const rr of rows) {
            const type = String(rr.type);
            sums[type] = sums[type] || { debit: 0, credit: 0 };
            sums[type].debit += Number(rr.debit || 0);
            sums[type].credit += Number(rr.credit || 0);
        }
        const totalRevenue = (sums['revenue']?.credit || 0) - (sums['revenue']?.debit || 0);
        const totalExpense = (sums['expense']?.debit || 0) - (sums['expense']?.credit || 0);
        const profit = totalRevenue - totalExpense;
        return res.json({ summary: { revenue: totalRevenue, expense: totalExpense, profit }, message: (0, i18n_1.t)('reports.profitLoss.fetched', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * GET /journals-pivot-raw
 * Returns raw journal items with computed row/column keys for client-side pivoting.
 * Query params:
 * - fiscal_year_id (required)
 * - start_date, end_date (optional, YYYY-MM-DD)
 * - journal_code_from, journal_code_to (optional)
 * - account_code_from, account_code_to (optional)
 * - row_dim, col_dim (optional: 'month'|'date'|'status'|'journal_code'|'account_code'|'detail_code')
 * Notes:
 * - Only permanent journals by default; pass status=all to include all.
 */
exports.reportsRouter.get('/journals-pivot-raw', async (req, res) => {
    const lang = req.lang || 'en';
    const fiscal_year_id = String(req.query.fiscal_year_id || req.query.fy_id || '');
    if (!fiscal_year_id)
        return res.status(400).json({ ok: false, error: (0, i18n_1.t)('error.invalidInput', lang) });
    // Extract filters safely
    const start_date = req.query.start_date ? String(req.query.start_date) : null;
    const end_date = req.query.end_date ? String(req.query.end_date) : null;
    const journal_code_from = req.query.journal_code_from ? Number(req.query.journal_code_from) : null;
    const journal_code_to = req.query.journal_code_to ? Number(req.query.journal_code_to) : null;
    const account_code_from = req.query.account_code_from ? Number(req.query.account_code_from) : null;
    const account_code_to = req.query.account_code_to ? Number(req.query.account_code_to) : null;
    const status = req.query.status ? String(req.query.status) : 'permanent';
    // Dimensions: whitelist to prevent SQL injection
    const allowedDims = new Set(['month', 'date', 'status', 'journal_code', 'account_code', 'detail_code']);
    const row_dim_raw = String(req.query.row_dim || 'month').toLowerCase();
    const col_dim_raw = String(req.query.col_dim || 'status').toLowerCase();
    const row_dim = allowedDims.has(row_dim_raw) ? row_dim_raw : 'month';
    const col_dim = allowedDims.has(col_dim_raw) ? col_dim_raw : 'status';
    // Helper to map dimension to SQL expression
    /**
     * getDimExpr
     * Returns SQL fragment to compute a dimension key value.
     */
    function getDimExpr(dim) {
        switch (dim) {
            case 'month':
                return `to_char(j.date, 'YYYY-MM')`;
            case 'date':
                return `to_char(j.date, 'YYYY-MM-DD')`;
            case 'status':
                return `j.status`;
            case 'journal_code':
                return `COALESCE(j.code::text, '-')`;
            case 'account_code':
                return `COALESCE(a.code::text, '-')`;
            case 'detail_code':
                return `COALESCE(d.code::text, '-')`;
            default:
                return `to_char(j.date, 'YYYY-MM')`;
        }
    }
    // Base SQL selecting raw items with row/col keys
    let sql = `SELECT
               ${getDimExpr(row_dim)} AS row_key,
               ${getDimExpr(col_dim)} AS col_key,
               ji.debit::numeric AS debit,
               ji.credit::numeric AS credit,
               j.id AS journal_id,
               to_char(j.date, 'YYYY-MM-DD') AS date,
               COALESCE(j.code, NULL) AS journal_code,
               COALESCE(a.code, NULL) AS account_code,
               COALESCE(d.code, NULL) AS detail_code
             FROM journal_items ji
             JOIN journals j ON j.id = ji.journal_id
             JOIN accounts a ON a.id = ji.account_id
             LEFT JOIN details d ON d.id = ji.detail_id
             WHERE j.fiscal_year_id = $1`;
    const params = [fiscal_year_id];
    // Status filter: default permanent only
    if (status !== 'all') {
        sql += ` AND j.status = 'permanent'`;
    }
    // Date range filter
    if (start_date && end_date) {
        sql += ` AND j.date BETWEEN $2 AND $3`;
        params.push(start_date, end_date);
    }
    else if (start_date) {
        sql += ` AND j.date >= $2`;
        params.push(start_date);
    }
    else if (end_date) {
        sql += ` AND j.date <= $2`;
        params.push(end_date);
    }
    // Journal code range filter
    if (journal_code_from != null && journal_code_to != null) {
        sql += ` AND j.code BETWEEN $${params.length + 1} AND $${params.length + 2}`;
        params.push(journal_code_from, journal_code_to);
    }
    else if (journal_code_from != null) {
        sql += ` AND j.code >= $${params.length + 1}`;
        params.push(journal_code_from);
    }
    else if (journal_code_to != null) {
        sql += ` AND j.code <= $${params.length + 1}`;
        params.push(journal_code_to);
    }
    // Account code range filter
    if (account_code_from != null && account_code_to != null) {
        sql += ` AND a.code BETWEEN $${params.length + 1} AND $${params.length + 2}`;
        params.push(account_code_from, account_code_to);
    }
    else if (account_code_from != null) {
        sql += ` AND a.code >= $${params.length + 1}`;
        params.push(account_code_from);
    }
    else if (account_code_to != null) {
        sql += ` AND a.code <= $${params.length + 1}`;
        params.push(account_code_to);
    }
    // Order for stable output
    sql += ` ORDER BY j.date ASC, j.ref_no ASC, ji.id ASC`;
    try {
        const p = (0, pg_1.getPool)();
        const r = await p.query(sql, params);
        const items = r.rows || [];
        // Compute simple totals server-side for quick summaries
        const totals = items.reduce((acc, it) => {
            acc.debit += Number(it.debit || 0);
            acc.credit += Number(it.credit || 0);
            acc.count += 1;
            return acc;
        }, { debit: 0, credit: 0, count: 0 });
        return res.json({ items, totals, message: (0, i18n_1.t)('reports.journalsPivotRaw.fetched', lang) });
    }
    catch (err) {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
