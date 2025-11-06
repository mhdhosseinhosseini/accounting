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
 * Tests for account endpoints: create, list, update, delete, and tree.
 */
describe('Accounts API', () => {
  const app = createApp();
  const auth = `Bearer ${makeToken()}`;

  it('creates a root account and lists it', async () => {
    const createRes = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', auth)
      .send({ code: '1000', name: 'Cash', type: 'asset' });
    expect(createRes.status).toBe(201);
    expect(createRes.body).toHaveProperty('id');

    const listRes = await request(app)
      .get('/api/v1/accounts')
      .set('Authorization', auth);
    expect(listRes.status).toBe(200);
    const items = listRes.body.items as any[];
    expect(items.some((a) => a.code === '1000' && a.type === 'asset')).toBe(true);
    expect(listRes.body.message).toBe('Accounts fetched');
  });

  it('prevents duplicate account code', async () => {
    const dupRes = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', auth)
      .send({ code: '1000', name: 'Cash Dup', type: 'asset' });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error).toBe('Account code already exists');
  });

  it('updates an account and builds the account tree', async () => {
    // Create a parent
    const parentRes = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', auth)
      .send({ code: '1100', name: 'Bank Accounts', type: 'asset' });
    const parentId = parentRes.body.id;

    // Create child under parent
    const childRes = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', auth)
      .send({ code: '1101', name: 'Bank A', type: 'asset', parent_id: parentId });
    const childId = childRes.body.id;

    // Update child name
    const updRes = await request(app)
      .patch(`/api/v1/accounts/${childId}`)
      .set('Authorization', auth)
      .send({ name: 'Bank A Main' });
    expect(updRes.status).toBe(200);

    // Fetch tree
    const treeRes = await request(app)
      .get('/api/v1/accounts/tree')
      .set('Authorization', auth);
    expect(treeRes.status).toBe(200);
    expect(Array.isArray(treeRes.body.tree)).toBe(true);
    // Find parent node and check children
    const parentNode = (treeRes.body.tree as any[]).find((n) => n.code === '1100');
    expect(parentNode).toBeTruthy();
    const hasChild = (parentNode.children as any[]).some((c: any) => c.code === '1101' && c.name === 'Bank A Main');
    expect(hasChild).toBe(true);
  });

  it('returns Farsi message when Accept-Language is fa', async () => {
    const res = await request(app)
      .get('/api/v1/accounts')
      .set('Authorization', auth)
      .set('Accept-Language', 'fa');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('حساب‌ها بازیابی شدند');
  });
});