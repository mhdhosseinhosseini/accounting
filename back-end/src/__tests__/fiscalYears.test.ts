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
 * Tests for fiscal year endpoints: create, list, get, update, close.
 */
describe('Fiscal Years API', () => {
  const app = createApp();
  const auth = `Bearer ${makeToken()}`;

  it('creates a fiscal year and lists it', async () => {
    const createRes = await request(app)
      .post('/api/v1/fiscal-years')
      .set('Authorization', auth)
      .send({ name: 'FY 1404', start_date: '2025-03-21', end_date: '2026-03-20' });
    expect(createRes.status).toBe(201);
    expect(createRes.body).toHaveProperty('id');

    const listRes = await request(app)
      .get('/api/v1/fiscal-years')
      .set('Authorization', auth);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.items)).toBe(true);
    expect(listRes.body.items.length).toBeGreaterThanOrEqual(1);
    expect(listRes.body.message).toBe('Fiscal years fetched');
  });

  it('rejects invalid date range', async () => {
    const res = await request(app)
      .post('/api/v1/fiscal-years')
      .set('Authorization', auth)
      .send({ name: 'Bad FY', start_date: '2026-03-20', end_date: '2025-03-21' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Start date must be before end date');
  });

  it('closes a fiscal year and reflects in fetch', async () => {
    const createRes = await request(app)
      .post('/api/v1/fiscal-years')
      .set('Authorization', auth)
      .send({ name: 'FY 1405', start_date: '2026-03-21', end_date: '2027-03-20' });
    const id = createRes.body.id as string;

    const closeRes = await request(app)
      .post(`/api/v1/fiscal-years/${id}/close`)
      .set('Authorization', auth);
    expect(closeRes.status).toBe(200);

    const getRes = await request(app)
      .get(`/api/v1/fiscal-years/${id}`)
      .set('Authorization', auth);
    expect(getRes.status).toBe(200);
    expect(getRes.body.item).toBeTruthy();
    expect(getRes.body.item.is_closed === 1 || getRes.body.item.is_closed === true).toBe(true);
  });

  it('opens the next fiscal year after closing the current', async () => {
    // Create fiscal year
    const createRes = await request(app)
      .post('/api/v1/fiscal-years')
      .set('Authorization', auth)
      .send({ name: 'FY 1409', start_date: '2030-03-21', end_date: '2031-03-20' });
    const id = createRes.body.id as string;

    // Close current fiscal year
    const closeRes = await request(app)
      .post(`/api/v1/fiscal-years/${id}/close`)
      .set('Authorization', auth);
    expect(closeRes.status).toBe(200);

    // Open next fiscal year with name override
    const nextRes = await request(app)
      .post(`/api/v1/fiscal-years/${id}/open-next`)
      .set('Authorization', auth)
      .send({ name: 'FY 1410' });
    expect(nextRes.status).toBe(201);
    expect(nextRes.body.message).toBe('Next fiscal year opened');
    const nextId = nextRes.body.id as string;

    // Verify dates are correct
    const getRes = await request(app)
      .get(`/api/v1/fiscal-years/${nextId}`)
      .set('Authorization', auth);
    expect(getRes.status).toBe(200);
    const item = getRes.body.item as any;
    expect(item.start_date).toBe('2031-03-21');
    expect(item.end_date).toBe('2032-03-20');
  });

  it('rejects opening next fiscal year if current is not closed', async () => {
    const createRes = await request(app)
      .post('/api/v1/fiscal-years')
      .set('Authorization', auth)
      .send({ name: 'FY 1411', start_date: '2032-03-21', end_date: '2033-03-20' });
    const id = createRes.body.id as string;

    const res = await request(app)
      .post(`/api/v1/fiscal-years/${id}/open-next`)
      .set('Authorization', auth);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Fiscal year must be closed before opening next');
  });
  it('returns Farsi message when Accept-Language is fa', async () => {
    const res = await request(app)
      .get('/api/v1/fiscal-years')
      .set('Authorization', auth)
      .set('Accept-Language', 'fa');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('سال‌های مالی بازیابی شد');
  });
});