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
 * Tests for warehouse endpoints: create, list, update, delete, and i18n.
 */
describe('Warehouses API', () => {
  const app = createApp();
  const auth = `Bearer ${makeToken()}`;

  it('creates a warehouse and lists it', async () => {
    const createRes = await request(app)
      .post('/api/v1/warehouses')
      .set('Authorization', auth)
      .send({ name: 'Main Warehouse', code: 'WH-A' });
    expect(createRes.status).toBe(201);
    expect(createRes.body).toHaveProperty('id');

    const listRes = await request(app)
      .get('/api/v1/warehouses')
      .set('Authorization', auth);
    expect(listRes.status).toBe(200);
    const items = listRes.body.items as any[];
    expect(items.some((w) => w.code === 'WH-A' && w.name === 'Main Warehouse')).toBe(true);
    expect(listRes.body.message).toBe('Warehouses fetched');
  });

  it('prevents duplicate warehouse code', async () => {
    const dupRes = await request(app)
      .post('/api/v1/warehouses')
      .set('Authorization', auth)
      .send({ name: 'Another', code: 'WH-A' });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error).toBe('Warehouse code already exists');
  });

  it('updates a warehouse name', async () => {
    const createRes = await request(app)
      .post('/api/v1/warehouses')
      .set('Authorization', auth)
      .send({ name: 'West Warehouse', code: 'WH-W' });
    const id = createRes.body.id as string;

    const updRes = await request(app)
      .patch(`/api/v1/warehouses/${id}`)
      .set('Authorization', auth)
      .send({ name: 'West Warehouse v2' });
    expect(updRes.status).toBe(200);
    expect(updRes.body.message).toBe('Warehouse updated');
  });

  it('deletes a warehouse and returns 404 when deleting again', async () => {
    const createRes = await request(app)
      .post('/api/v1/warehouses')
      .set('Authorization', auth)
      .send({ name: 'Temp Warehouse', code: 'WH-T' });
    const id = createRes.body.id as string;

    const delRes = await request(app)
      .delete(`/api/v1/warehouses/${id}`)
      .set('Authorization', auth);
    expect(delRes.status).toBe(200);
    expect(delRes.body.message).toBe('Warehouse deleted');

    const delAgainRes = await request(app)
      .delete(`/api/v1/warehouses/${id}`)
      .set('Authorization', auth);
    expect(delAgainRes.status).toBe(404);
    expect(delAgainRes.body.error).toBe('Warehouse not found');
  });

  it('returns Farsi message when Accept-Language is fa', async () => {
    const res = await request(app)
      .get('/api/v1/warehouses')
      .set('Authorization', auth)
      .set('Accept-Language', 'fa');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('انبارها بازیابی شدند');
  });
});