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
 * Tests for journals endpoints: create balanced/unbalanced, post, and immutability after post.
 */
describe('Journals API', () => {
  const app = createApp();
  const auth = `Bearer ${makeToken()}`;

  it('creates a balanced journal and posts it', async () => {
    // Create fiscal year
    const fyRes = await request(app)
      .post('/api/v1/fiscal-years')
      .set('Authorization', auth)
      .send({ name: 'FY 1406', start_date: '2027-03-21', end_date: '2028-03-20' });
    expect(fyRes.status).toBe(201);
    const fiscal_year_id = fyRes.body.id as string;

    // Create two accounts
    const acc1 = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', auth)
      .send({ code: '1200', name: 'Receivables', type: 'asset' });
    expect(acc1.status).toBe(201);
    const acc1Id = acc1.body.id as string;

    const acc2 = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', auth)
      .send({ code: '2200', name: 'Payables', type: 'liability' });
    expect(acc2.status).toBe(201);
    const acc2Id = acc2.body.id as string;

    // Create balanced journal
    const jRes = await request(app)
      .post('/api/v1/journals')
      .set('Authorization', auth)
      .send({
        fiscal_year_id,
        date: '2027-04-01',
        ref_no: 'J-0001',
        description: 'Initial entry',
        items: [
          { account_id: acc1Id, debit: 100, credit: 0, description: 'Debit receivables' },
          { account_id: acc2Id, debit: 0, credit: 100, description: 'Credit payables' },
        ],
      });
    expect(jRes.status).toBe(201);
    expect(jRes.body.message).toBe('Journal draft created');
    const journalId = jRes.body.id as string;

    // Post journal
    const postRes = await request(app)
      .post(`/api/v1/journals/${journalId}/post`)
      .set('Authorization', auth);
    expect(postRes.status).toBe(200);
    expect(postRes.body.message).toBe('Journal posted successfully');

    // Attempt to modify after posting
    const updRes = await request(app)
      .patch(`/api/v1/journals/${journalId}`)
      .set('Authorization', auth)
      .send({ description: 'Should not change' });
    expect(updRes.status).toBe(400);
    expect(updRes.body.error).toBe('Posted journal cannot be modified');
  });

  it('rejects unbalanced journal creation', async () => {
    // Create fiscal year
    const fyRes = await request(app)
      .post('/api/v1/fiscal-years')
      .set('Authorization', auth)
      .send({ name: 'FY 1407', start_date: '2028-03-21', end_date: '2029-03-20' });
    expect(fyRes.status).toBe(201);
    const fiscal_year_id = fyRes.body.id as string;

    // Create two accounts
    const acc1 = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', auth)
      .send({ code: '1300', name: 'Inventory', type: 'asset' });
    expect(acc1.status).toBe(201);
    const acc1Id = acc1.body.id as string;

    const acc2 = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', auth)
      .send({ code: '3300', name: 'Revenue', type: 'revenue' });
    expect(acc2.status).toBe(201);
    const acc2Id = acc2.body.id as string;

    // Create unbalanced journal
    const jRes = await request(app)
      .post('/api/v1/journals')
      .set('Authorization', auth)
      .send({
        fiscal_year_id,
        date: '2028-04-01',
        description: 'Unbalanced test',
        items: [
          { account_id: acc1Id, debit: 100, credit: 0 },
          { account_id: acc2Id, debit: 0, credit: 50 },
        ],
      });
    expect(jRes.status).toBe(400);
    expect(jRes.body.error).toBe('Journal is not balanced');
  });

  it('reverses a posted journal and prevents reversing drafts', async () => {
    // Create fiscal year
    const fyRes = await request(app)
      .post('/api/v1/fiscal-years')
      .set('Authorization', auth)
      .send({ name: 'FY 1408', start_date: '2029-03-21', end_date: '2030-03-20' });
    const fiscal_year_id = fyRes.body.id as string;

    // Create two accounts
    const acc1 = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', auth)
      .send({ code: '1400', name: 'Cash', type: 'asset' });
    const acc1Id = acc1.body.id as string;

    const acc2 = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', auth)
      .send({ code: '2400', name: 'Sales', type: 'revenue' });
    const acc2Id = acc2.body.id as string;

    // Create and post a balanced journal
    const jRes = await request(app)
      .post('/api/v1/journals')
      .set('Authorization', auth)
      .send({
        fiscal_year_id,
        date: '2029-04-01',
        description: 'Sale entry',
        items: [
          { account_id: acc1Id, debit: 200, credit: 0 },
          { account_id: acc2Id, debit: 0, credit: 200 },
        ],
      });
    const journalId = jRes.body.id as string;
    await request(app).post(`/api/v1/journals/${journalId}/post`).set('Authorization', auth);

    // Reverse the posted journal
    const revRes = await request(app)
      .post(`/api/v1/journals/${journalId}/reverse`)
      .set('Authorization', auth);
    expect(revRes.status).toBe(200);
    expect(revRes.body.status).toBe('posted');
    expect(revRes.body.message).toBe('Journal reversed successfully');

    // Create a draft journal and attempt to reverse (should fail)
    const draftRes = await request(app)
      .post('/api/v1/journals')
      .set('Authorization', auth)
      .send({
        fiscal_year_id,
        date: '2029-04-02',
        description: 'Draft entry',
        items: [
          { account_id: acc1Id, debit: 50, credit: 0 },
          { account_id: acc2Id, debit: 0, credit: 50 },
        ],
      });
    const draftId = draftRes.body.id as string;
    const revDraft = await request(app)
      .post(`/api/v1/journals/${draftId}/reverse`)
      .set('Authorization', auth);
    expect(revDraft.status).toBe(400);
    expect(revDraft.body.error).toBe('Only posted journals can be reversed');
  });

  it('returns Farsi message on list when Accept-Language is fa', async () => {
    const res = await request(app)
      .get('/api/v1/journals')
      .set('Authorization', auth)
      .set('Accept-Language', 'fa');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('سندها بازیابی شدند');
  });
});