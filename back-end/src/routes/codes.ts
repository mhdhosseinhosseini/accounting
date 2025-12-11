import { Router, Request, Response } from 'express';

import { getPool } from '../db/pg';
import { randomUUID } from 'crypto';
import { t, Lang } from '../i18n';

/**
 * Codes router: implements General → Specific codes with tree endpoint.
 * Postgres-only implementation.
 */
const codesRouter = Router();


// Shared record shape for codes rows
interface CodeRecord {
  id: string;
  code: string;
  title: string;
  kind: 'group' | 'general' | 'specific';
  parent_id: string | null;
  is_active: boolean | number;
  nature?: number | null;
  can_have_details?: boolean;
  created_at?: string;
}

/**
 * Parse and validate nature field.
 * Accepts 0 (Debitor), 1 (Creditor), or null/undefined for None.
 */
function parseNature(n: any): number | null {
  if (n === undefined || n === null || n === '') return null;
  const num = Number(n);
  if (Number.isNaN(num)) return null;
  if (num === 0 || num === 1) return num;
  return null;
}

/**
 * Validate code payload. Enforces kind and basic fields.
 */
function validatePayload(body: any): { ok: boolean; error?: string } {
  const kind = String(body.kind || '').toLowerCase();
  if (!['group', 'general', 'specific'].includes(kind)) {
    return { ok: false, error: 'codes.invalidKind' };
  }
  if (!body.code || !String(body.code).trim()) {
    return { ok: false, error: 'error.invalidInput' };
  }
  if (!body.title || !String(body.title).trim()) {
    return { ok: false, error: 'error.invalidInput' };
  }
  // Group codes must be exactly two digits
  if (kind === 'group' && !/^\d{2}$/.test(String(body.code))) {
    return { ok: false, error: 'error.invalidInput' };
  }
  return { ok: true };
}

/**
 * GET /api/v1/codes
 * List all codes (flat list).
 */
/**
 * GET /api/v1/codes
 * List all codes (flat list).
 * Postgres-only implementation.
 */
codesRouter.get('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM codes ORDER BY kind ASC, code ASC');
    return res.json({ message: t('codes.list', lang), data: rows });
  } catch {
    return res.status(500).json({ message: t('error.generic', lang) });
  }
});

/**
 * GET /api/v1/codes/tree
 * Build a tree: Generals at root, Specifics under their parent.
 * Postgres-only implementation.
 */
codesRouter.get('/tree', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    const p = getPool();
    const result = await p.query('SELECT * FROM codes ORDER BY kind ASC, code ASC');
    const rows = result.rows as CodeRecord[];

    const groups: CodeRecord[] = rows.filter((r: CodeRecord) => r.kind === 'group');
    const generals: CodeRecord[] = rows.filter((r: CodeRecord) => r.kind === 'general');
    const specifics: CodeRecord[] = rows.filter((r: CodeRecord) => r.kind === 'specific');

    const generalsByGroup: Record<string, CodeRecord[]> = {};
    for (const g of generals) {
      const pid = g.parent_id || '__root__';
      generalsByGroup[pid] = generalsByGroup[pid] || [];
      generalsByGroup[pid].push(g);
    }

    const specificsByGeneral: Record<string, CodeRecord[]> = {};
    for (const sp of specifics) {
      const pid = sp.parent_id || '__root__';
      specificsByGeneral[pid] = specificsByGeneral[pid] || [];
      specificsByGeneral[pid].push(sp);
    }

    const tree = groups.map((grp: CodeRecord) => ({
      ...grp,
      children: (generalsByGroup[grp.id] || []).map((gen: CodeRecord) => ({
        ...gen,
        children: specificsByGeneral[gen.id] || [],
      })),
    }));
    return res.json({ message: t('codes.tree', lang), data: tree });
  } catch {
    return res.status(500).json({ message: t('error.generic', lang) });
  }
});

/**
 * GET /api/v1/codes/:id
 * Fetch a single code by id.
 */
codesRouter.get('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = req.params.id;
  try {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM codes WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ message: t('codes.notFound', lang) });
    return res.json({ message: t('codes.fetchOne', lang), data: rows[0] });
  } catch {
    return res.status(500).json({ message: t('error.generic', lang) });
  }
});

/**
 * POST /api/v1/codes
 * Create a new code. Enforces unique code.
 */
codesRouter.post('/', async (req: Request, res: Response) => {
  // Create a new code (Postgres-only). Validates kind, parent relation, and uniqueness.
  const lang: Lang = (req as any).lang || 'en';
  const payload = req.body || {};
  const valid = validatePayload(payload);
  if (!valid.ok) return res.status(400).json({ message: t(valid.error as any, lang) });

  const id = randomUUID();
  const { code, title } = payload;
  const kind = String(payload.kind).toLowerCase();
  const parentId = payload.parent_id || null;
  const isActive = payload.is_active === false ? false : true;
  const nature = parseNature(payload.nature);
  // Nature can be null (no nature). Do not enforce validation; map invalid values to null.

  try {
    const p = getPool();

    // Relationship validation by kind
    if (kind === 'group') {
      if (parentId) return res.status(400).json({ message: t('codes.invalidParent', lang) });
    } else if (kind === 'general') {
      if (!parentId) return res.status(400).json({ message: t('codes.invalidParent', lang) });
      const pr = await p.query('SELECT kind FROM codes WHERE id = $1', [parentId]);
      const pk = pr.rows[0]?.kind;
      if (pk !== 'group') return res.status(400).json({ message: t('codes.invalidParent', lang) });
    } else if (kind === 'specific') {
      if (!parentId) return res.status(400).json({ message: t('codes.invalidParent', lang) });
      const pr = await p.query('SELECT kind FROM codes WHERE id = $1', [parentId]);
      const pk = pr.rows[0]?.kind;
      if (pk !== 'general') return res.status(400).json({ message: t('codes.invalidParent', lang) });
    }

    // Uniqueness
    const dup = await p.query('SELECT 1 FROM codes WHERE code = $1', [code]);
    if (dup.rowCount && dup.rows[0]) return res.status(409).json({ message: t('codes.duplicateCode', lang) });

    // Insert (defaults: is_active=true, can_have_details=true)
    await p.query(
      'INSERT INTO codes (id, code, title, kind, parent_id, is_active, nature, can_have_details) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, TRUE))',
      [id, code, title, kind, parentId, isActive, nature, (payload.can_have_details ?? null)]
    );
    const { rows } = await p.query('SELECT * FROM codes WHERE id = $1', [id]);
    return res.status(201).json({ message: t('codes.created', lang), data: rows[0] });
  } catch {
    return res.status(500).json({ message: t('error.generic', lang) });
  }
});

/**
 * PATCH /api/v1/codes/:id
 * Update a code by id.
 */
codesRouter.patch('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = req.params.id;
  const payload = req.body || {};

  if (payload.kind) {
    const kind = String(payload.kind).toLowerCase();
    if (!['group', 'general', 'specific'].includes(kind)) {
      return res.status(400).json({ message: t('codes.invalidKind', lang) });
    }
    // When updating to group, enforce two-digit code if provided
    if (kind === 'group' && payload.code && !/^\d{2}$/.test(String(payload.code))) {
      return res.status(400).json({ message: t('error.invalidInput', lang) });
    }
  }

  // Validate nature if present
  const nature = parseNature(payload.nature);
  const natureProvided = Object.prototype.hasOwnProperty.call(payload, 'nature');
  // Nature can be null or omitted. If provided with an invalid value, treat as null.

  try {
    const p = getPool();
    const found = await p.query('SELECT * FROM codes WHERE id = $1', [id]);
    if (!found.rows[0]) return res.status(404).json({ message: t('codes.notFound', lang) });

    const current = found.rows[0] as CodeRecord;
    const nextKind: CodeRecord['kind'] = payload.kind ? String(payload.kind).toLowerCase() as any : current.kind;
    const nextParentId: string | null = (payload.parent_id !== undefined) ? (payload.parent_id || null) : current.parent_id;

    // Relationship validation by next state
    if (nextKind === 'group') {
      if (nextParentId) return res.status(400).json({ message: t('codes.invalidParent', lang) });
    } else if (nextKind === 'general') {
      if (!nextParentId) return res.status(400).json({ message: t('codes.invalidParent', lang) });
      const pr = await p.query('SELECT kind FROM codes WHERE id = $1', [nextParentId]);
      const pk = pr.rows[0]?.kind;
      if (pk !== 'group') return res.status(400).json({ message: t('codes.invalidParent', lang) });
    } else if (nextKind === 'specific') {
      if (!nextParentId) return res.status(400).json({ message: t('codes.invalidParent', lang) });
      const pr = await p.query('SELECT kind FROM codes WHERE id = $1', [nextParentId]);
      const pk = pr.rows[0]?.kind;
      if (pk !== 'general') return res.status(400).json({ message: t('codes.invalidParent', lang) });
    }

    if (payload.code) {
      const dup = await p.query('SELECT 1 FROM codes WHERE code = $1 AND id <> $2', [payload.code, id]);
      if (dup.rowCount && dup.rows[0]) return res.status(409).json({ message: t('codes.duplicateCode', lang) });
    }

    await p.query(
      'UPDATE codes SET code = COALESCE($1, code), title = COALESCE($2, title), kind = COALESCE($3, kind), parent_id = COALESCE($4, parent_id), is_active = COALESCE($5, is_active), nature = CASE WHEN $7 = true THEN $6 ELSE nature END, can_have_details = COALESCE($8, can_have_details) WHERE id = $9',
      [payload.code || null, payload.title || null, payload.kind || null, (payload.parent_id ?? null), (payload.is_active ?? null), nature, natureProvided, (payload.can_have_details ?? null), id]
    );
    const { rows } = await p.query('SELECT * FROM codes WHERE id = $1', [id]);
    return res.json({ message: t('codes.updated', lang), data: rows[0] });
  } catch {
    return res.status(500).json({ message: t('error.generic', lang) });
  }
});

/**
 * DELETE /api/v1/codes/:id
 * Delete a code by id.
 */
codesRouter.delete('/:id', async (req: Request, res: Response) => {
  // Delete a code by id (Postgres-only). Verifies existence before deletion.
  const lang: Lang = (req as any).lang || 'en';
  const id = req.params.id;
  try {
    const p = getPool();
    const found = await p.query('SELECT 1 FROM codes WHERE id = $1', [id]);
    if (!found.rowCount) return res.status(404).json({ message: t('codes.notFound', lang) });
    await p.query('DELETE FROM codes WHERE id = $1', [id]);
    return res.json({ message: t('codes.deleted', lang) });
  } catch {
    return res.status(500).json({ message: t('error.generic', lang) });
  }
});

/* moved codes /tree route above /:id to prevent route shadowing */

export default codesRouter;