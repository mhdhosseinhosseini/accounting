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
 * Tests for invoices endpoints: create draft, post, and inventory linkage.
 */
describe('Invoices API', () => {
  const app = createApp();
  const auth = `Bearer ${makeToken()}`;

  it('creates a draft invoice, posts it, and records inventory out', async () => {
    // Create fiscal year
    const fyRes = await request(app)
      .post('/api/v1/fiscal-years')
      .set('Authorization', auth)
      .send({ name: 'FY 1406', start_date: '2027-03-21', end_date: '2028-03-20' });
    expect(fyRes.status).toBe(201);
    const fiscal_year_id = fyRes.body.id as string;

    // Create accounts: receivable (asset) and sales (revenue)
    const receivableRes = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', auth)
      .send({ code: '1200', name: 'Receivables', type: 'asset' });
    expect(receivableRes.status).toBe(201);
    const receivable_account_id = receivableRes.body.id as string;

    const salesRes = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', auth)
      .send({ code: '4100', name: 'Sales', type: 'revenue' });
    expect(salesRes.status).toBe(201);
    const sales_account_id = salesRes.body.id as string;

    // Create warehouse
    const whRes = await request(app)
      .post('/api/v1/warehouses')
      .set('Authorization', auth)
      .send({ code: 'WH-1', name: 'Main Warehouse' });
    expect(whRes.status).toBe(201);
    const warehouse_id = whRes.body.id as string;

    // Create product
    const prodRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', auth)
      .send({ name: 'Widget A', sku: 'W-A', price: 100 });
    expect(prodRes.status).toBe(201);
    const product_id = prodRes.body.id as string;

    // Create draft invoice
    const invCreate = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', auth)
      .send({
        fiscal_year_id,
        customer_id: null,
        date: '2027-04-01',
        invoice_no: 'INV-001',
        items: [
          { product_id, quantity: 2, unit_price: 150 },
        ],
      });
    expect(invCreate.status).toBe(201);
    const invoiceId = invCreate.body.id as string;

    // Post invoice with accounts and warehouse linkage
    const postRes = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/post`)
      .set('Authorization', auth)
      .send({
        accounts: { receivable_account_id, sales_account_id },
        warehouse_id,
      });
    expect(postRes.status).toBe(200);
    expect(postRes.body.status).toBe('posted');

    // Fetch posted invoice and verify status/items
    const invGet = await request(app)
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', auth);
    expect(invGet.status).toBe(200);
    expect(invGet.body.item.status).toBe('posted');
    expect(Array.isArray(invGet.body.item.items)).toBe(true);
    expect(invGet.body.item.items.length).toBe(1);

    // List inventory transactions and verify an 'out' entry exists for INV-001
    const invList = await request(app)
      .get('/api/v1/inventory')
      .set('Authorization', auth);
    expect(invList.status).toBe(200);
    const txs = invList.body.items as any[];
    expect(txs.some((tx) => tx.type === 'out' && String(tx.reference).includes('INV-001'))).toBe(true);

    // Ensure posted invoice cannot be modified
    const invPatch = await request(app)
      .patch(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', auth)
      .send({ invoice_no: 'INV-001-EDIT' });
    expect(invPatch.status).toBe(400);
  });
});