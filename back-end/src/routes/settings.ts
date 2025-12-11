import express, { Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPool } from '../db/pg';
import { requireAuth } from '../middleware/auth';
import { t, Lang } from '../i18n';

/**
 * settingsRouter
 * CRUD routes for application settings with flexible JSONB `value`.
 * Allows inline list management: list, create, update, delete.
 */
export const settingsRouter = express.Router();

// Protect all routes
settingsRouter.use(requireAuth);

/** Zod schema: create setting payload */
const createSchema = z.object({
  code: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  // Accept any JSON-serializable value
  value: z.any().optional(),
  // Internal-only special code id; never shown to users
  special_id: z.string().optional(),
  // Persisted field: controls UI behavior for this setting
  type: z.enum(['special','digits','string'])
});

/** Zod schema: update setting payload */
const updateSchema = z.object({
  code: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(200).optional(),
  value: z.any().optional(),
  special_id: z.string().optional(),
  type: z.enum(['special','digits','string']).optional()
});

/**
 * GET / - List all settings sorted by code
 */
settingsRouter.get('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    const p = getPool();
    const r = await p.query(`SELECT id, code, name, value, special_id, type FROM settings ORDER BY code ASC`);
    return res.json({ items: r.rows, message: t('settings.list', lang) });
  } catch (e) {
    console.error('List settings failed:', e);
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST / - Create a new setting
 * Enforces special_id-only semantics when type === 'special':
 * - Requires a valid UUID in `special_id`
 * - Forces `value` to NULL to avoid storing direct code values
 */
settingsRouter.post('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parsed.error.issues });
  }
  const { code, name, value, special_id, type } = parsed.data;
  const id = randomUUID();
  try {
    const p = getPool();

    // Require special_id for special type, and set value to NULL
    const isSpecial = type === 'special';
    const isUuid = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(String(v));
    if (isSpecial) {
      if (!isUuid(special_id)) {
        return res.status(400).json({ ok: false, error: t('settings.specialIdRequired', lang) });
      }
    }

    const valParam = isSpecial ? null : (value === undefined ? null : JSON.stringify(value));

    await p.query(
      `INSERT INTO settings (id, code, name, value, special_id, type, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, NOW(), NOW())`,
      [id, code, name, valParam, special_id ?? null, type]
    );
    return res.status(201).json({ id, code, name, value: isSpecial ? null : value, special_id, type, message: t('settings.created', lang) });
  } catch (e: any) {
    if (String(e?.message || '').includes('unique') || String(e?.detail || '').includes('already exists')) {
      return res.status(409).json({ ok: false, error: t('settings.codeExists', lang) });
    }
    console.error('Create setting failed:', e);
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * PATCH /:id - Update setting by id
 * When switching to or using `type = 'special'`, enforce special_id presence
 * and clear `value` to NULL to avoid direct code values storage.
 */
settingsRouter.patch('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parsed.error.issues });
  }
  const data = parsed.data;
  try {
    const p = getPool();
    const sets: string[] = [];
    const params: any[] = [];

    if (data.code !== undefined) { params.push(data.code); sets.push(`code = $${params.length}`); }
    if (data.name !== undefined) { params.push(data.name); sets.push(`name = $${params.length}`); }

    const isUuid = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(String(v));

    // If explicitly setting type to special, require special_id and clear value
    if (data.type === 'special') {
      if (!isUuid(data.special_id)) {
        return res.status(400).json({ ok: false, error: t('settings.specialIdRequired', lang) });
      }
      sets.push(`value = NULL`);
    } else if (data.value !== undefined) {
      params.push(JSON.stringify(data.value));
      sets.push(`value = $${params.length}::jsonb`);
    }

    if (data.special_id !== undefined) { params.push(data.special_id); sets.push(`special_id = $${params.length}`); }
    if (data.type !== undefined) { params.push(data.type); sets.push(`type = $${params.length}`); }

    params.push(id);
    const sql = `UPDATE settings SET ${sets.length ? sets.join(', ') + ', ' : ''}updated_at = NOW() WHERE id = $${params.length} RETURNING id, code, name, value, special_id, type`;
    const r = await p.query(sql, params);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: t('settings.notFound', lang) });
    return res.json({ item: r.rows[0], message: t('settings.updated', lang) });
  } catch (e: any) {
    if (String(e?.message || '').includes('unique') || String(e?.detail || '').includes('already exists')) {
      return res.status(409).json({ ok: false, error: t('settings.codeExists', lang) });
    }
    console.error('Update setting failed:', e);
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * DELETE /:id - Delete a setting by id
 */
settingsRouter.delete('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    const p = getPool();
    const r = await p.query(`DELETE FROM settings WHERE id = $1`, [id]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: t('settings.notFound', lang) });
    return res.json({ ok: true, message: t('settings.deleted', lang) });
  } catch (e) {
    console.error('Delete setting failed:', e);
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

export default settingsRouter;