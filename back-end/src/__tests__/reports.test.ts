import request from 'supertest';
import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../index';
import { ensureSchema } from '../db/driver';

/**
 * Helper to create a signed JWT for test requests.
 */
function makeToken() {
  const secret = process.env.JWT_SECRET || 'dev-secret';
  return jwt.sign({ sub: '09123456789', role: 'admin' }, secret, { expiresIn: '1h' });
}

/**
 * Setup test environment: use SQLite in-memory and ensure schema.
 */
beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DB_DRIVER = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
  await ensureSchema();
});

/**
 * Tests for reports endpoints: trial balance, ledger, balance sheet, and profit & loss.
 */
describe('Reports API', () => {
  const app = createApp();
  const auth = `Bearer ${makeToken()}`;

  it('computes trial balance, ledger, balance sheet, and profit & loss', async () => {
    // Create fiscal year
    const fyRes = await request(app)
      .post('/api/v1/fiscal-years')
      .set('Authorization', auth)
      .send({ name: 'FY 1410', start_date: '2031-03-21', end_date: '2032-03-20' });
    expect(fyRes.status).toBe(201);
    const fiscal_year_id = fyRes.body.id as string;

    // Create accounts
    const cashRes = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', auth)
      .send({ code: '1000', name: 'Cash', type: 'asset' });
    expect(cashRes.status).toBe(201);
    const cashId = cashRes.body.id as string;

    const salesRes = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', auth)
      .send({ code: '4000', name: 'Sales', type: 'revenue' });
    expect(salesRes.status).toBe(201);
    const salesId = salesRes.body.id as string;

    const expenseRes = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', auth)
      .send({ code: '5000', name: 'Expense', type: 'expense' });
    expect(expenseRes.status).toBe(201);
    const expenseId = expenseRes.body.id as string;

    // Create and post two journals
    const j1 = await request(app)
      .post('/api/v1/journals')
      .set('Authorization', auth)
      .send({
        fiscal_year_id,
        date: '2031-04-01',
        ref_no: 'J-100',
        description: 'Sale entry',
        items: [
          { account_id: cashId, debit: 1000, credit: 0, description: 'Cash received' },
          { account_id: salesId, debit: 0, credit: 1000, description: 'Sales' },
        ],
      });
    expect(j1.status).toBe(201);
    const j1Id = j1.body.id as string;
    const post1 = await request(app).post(`/api/v1/journals/${j1Id}/post`).set('Authorization', auth);
    expect(post1.status).toBe(200);

    const j2 = await request(app)
      .post('/api/v1/journals')
      .set('Authorization', auth)
      .send({
        fiscal_year_id,
        date: '2031-04-02',
        ref_no: 'J-101',
        description: 'Expense entry',
        items: [
          { account_id: expenseId, debit: 200, credit: 0, description: 'Expense booked' },
          { account_id: cashId, debit: 0, credit: 200, description: 'Cash paid' },
        ],
      });
    expect(j2.status).toBe(201);
    const j2Id = j2.body.id as string;
    const post2 = await request(app).post(`/api/v1/journals/${j2Id}/post`).set('Authorization', auth);
    expect(post2.status).toBe(200);

    // Trial balance
    const tbRes = await request(app)
      .get(`/api/v1/reports/trial-balance?fiscal_year_id=${encodeURIComponent(fiscal_year_id)}`)
      .set('Authorization', auth);
    expect(tbRes.status).toBe(200);
    expect(tbRes.body.message).toBe('Trial balance computed');
    const tbItems = tbRes.body.items as any[];
    const cashRow = tbItems.find((r) => r.code === '1000');
    expect(cashRow.debit).toBe(1000);
    expect(cashRow.credit).toBe(200);
    const salesRow = tbItems.find((r) => r.code === '4000');
    expect(salesRow.credit).toBe(1000);
    const expenseRow = tbItems.find((r) => r.code === '5000');
    expect(expenseRow.debit).toBe(200);
    expect(tbRes.body.totals.debit).toBe(1200);
    expect(tbRes.body.totals.credit).toBe(1200);

    // Ledger for cash account
    const ledgerRes = await request(app)
      .get(`/api/v1/reports/ledger?fiscal_year_id=${encodeURIComponent(fiscal_year_id)}&account_id=${encodeURIComponent(cashId)}`)
      .set('Authorization', auth);
    expect(ledgerRes.status).toBe(200);
    expect(Array.isArray(ledgerRes.body.items)).toBe(true);
    expect(ledgerRes.body.items.length).toBe(2);
    const l1 = ledgerRes.body.items[0];
    const l2 = ledgerRes.body.items[1];
    expect(l1.debit).toBe(1000);
    expect(l2.credit).toBe(200);

    // Balance sheet
    const bsRes = await request(app)
      .get(`/api/v1/reports/balance-sheet?fiscal_year_id=${encodeURIComponent(fiscal_year_id)}`)
      .set('Authorization', auth);
    expect(bsRes.status).toBe(200);
    expect(bsRes.body.summary.assets).toBe(800);
    expect(bsRes.body.summary.liabilities_plus_equity).toBe(800);

    // Profit & loss
    const plRes = await request(app)
      .get(`/api/v1/reports/profit-loss?fiscal_year_id=${encodeURIComponent(fiscal_year_id)}`)
      .set('Authorization', auth);
    expect(plRes.status).toBe(200);
    expect(plRes.body.summary.revenue).toBe(1000);
    expect(plRes.body.summary.expense).toBe(200);
    expect(plRes.body.summary.profit).toBe(800);
  });

  it('returns Farsi message on trial balance when Accept-Language is fa', async () => {
    // Create fiscal year
    const fyRes = await request(app)
      .post('/api/v1/fiscal-years')
      .set('Authorization', auth)
      .send({ name: 'FY 1411', start_date: '2032-03-21', end_date: '2033-03-20' });
    const fiscal_year_id = fyRes.body.id as string;

    // Create minimal accounts and journal
    const cashRes = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', auth)
      .send({ code: '1010', name: 'Cash A', type: 'asset' });
    const cashId = cashRes.body.id as string;

    const salesRes = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', auth)
      .send({ code: '4010', name: 'Sales A', type: 'revenue' });
    const salesId = salesRes.body.id as string;

    const j1 = await request(app)
      .post('/api/v1/journals')
      .set('Authorization', auth)
      .send({
        fiscal_year_id,
        date: '2032-04-01',
        items: [
          { account_id: cashId, debit: 100, credit: 0 },
          { account_id: salesId, debit: 0, credit: 100 },
        ],
      });
    const j1Id = j1.body.id as string;
    await request(app).post(`/api/v1/journals/${j1Id}/post`).set('Authorization', auth);

    const tbRes = await request(app)
      .get(`/api/v1/reports/trial-balance?fiscal_year_id=${encodeURIComponent(fiscal_year_id)}`)
      .set('Authorization', auth)
      .set('Accept-Language', 'fa');
    expect(tbRes.status).toBe(200);
    expect(tbRes.body.message).toBe('تراز آزمایشی محاسبه شد');
  });
});