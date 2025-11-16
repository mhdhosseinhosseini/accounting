import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { t, Lang } from '../i18n';
import { requireAuth } from '../middleware/auth';
import { getPool } from '../db/pg';

/**
 * Router: Detail Levels
 * Implements hierarchical detail levels with self-referencing parent.
 * Root nodes must link to a 'specific' code via `specific_code_id`.
 * Postgres-only implementation under /api/v1/detail-levels.
 */
export const detailLevelsRouter = Router();

// Require authentication for all endpoints
detailLevelsRouter.use(requireAuth);

/**
 * Zod schema: Create request payload.
 * Enforces required fields and optional nullable parent/specific linkage.
 */
const createSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  parent_id: z.string().min(1).nullable().optional(),
  specific_code_id: z.string().min(1).nullable().optional(),
  is_active: z.boolean().optional(),
});

/**
 * Zod schema: Update request payload.
 * Allows partial updates of fields.
 */
const updateSchema = z.object({
  code: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  parent_id: z.string().min(1).nullable().optional(),
  specific_code_id: z.string().min(1).nullable().optional(),
  is_active: z.boolean().optional(),
});

/**
 * Helper: Detect if assigning `candidateParentId` to `selfId` would create a cycle.
 * Walks ancestors via `parent_id` up to a bounded depth to detect loops.
 */
async function wouldCreateCycle(candidateParentId: string | null, selfId: string): Promise<boolean> {
  if (!candidateParentId) return false;
  if (candidateParentId === selfId) return true;
  const p = getPool();
  let cur = candidateParentId;
  for (let i = 0; i < 512; i++) {
    const r = await p.query(`SELECT parent_id FROM detail_levels WHERE id = $1`, [cur]);
    if (r.rowCount === 0) return false;
    const next = r.rows[0].parent_id as string | null;
    if (!next) return false;
    if (String(next) === String(selfId)) return true;
    cur = String(next);
  }
  return false;
}

/**
 * Helper: Verify that a given `codeId` refers to a 'specific' code.
 * If the `codes` table is unavailable, returns true to avoid hard failure.
 */
async function ensureSpecificKind(codeId: string | null): Promise<boolean> {
  if (!codeId) return true;
  try {
    const p = getPool();
    const probe = await p.query("SELECT to_regclass('public.codes') AS exists");
    if (!probe.rows[0] || !probe.rows[0].exists) return true;
    const r = await p.query('SELECT kind FROM codes WHERE id = $1', [codeId]);
    return (r.rowCount || 0) > 0 && String(r.rows[0].kind) === 'specific';
  } catch {
    return true;
  }
}

/**
 * GET / - List all detail levels (flat).
 * Returns `id, code, title, parent_id, specific_code_id, is_active`.
 */
detailLevelsRouter.get('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    const p = getPool();
    const r = await p.query(
      `SELECT id, code, title, parent_id, specific_code_id, is_active FROM detail_levels ORDER BY code`
    );
    return res.json({ items: r.rows, message: t('detailLevels.list', lang) });
  } catch (e) {
    console.error('detailLevels GET / failed:', e);
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * GET /tree - Full tree of detail levels.
 * Builds nested children arrays by `parent_id` linkage.
 */
detailLevelsRouter.get('/tree', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    const p = getPool();
    const r = await p.query(
      `SELECT id, code, title, parent_id, specific_code_id, is_active FROM detail_levels ORDER BY code`
    );
    const rows: any[] = r.rows;
    const byId = new Map<string, any>();
    const roots: any[] = [];
    rows.forEach((r) => {
      byId.set(r.id, { ...r, children: [] });
    });
    rows.forEach((r) => {
      const node = byId.get(r.id);
      const pid = r.parent_id || null;
      if (pid && byId.has(pid)) {
        byId.get(pid).children.push(node);
      } else {
        roots.push(node);
      }
    });
    return res.json({ items: roots, message: t('detailLevels.tree', lang) });
  } catch (e) {
    console.error('detailLevels GET /tree failed:', e);
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * GET /children?parentId=... - List children of a node or roots.
 * Placed before `/:id` to ensure correct routing order in Express.
 * Returns children ordered by `code`; without `parentId` returns roots.
 */
detailLevelsRouter.get('/children', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const parentId = String(req.query.parentId || '') || null;
  try {
    const p = getPool();
    const sql = parentId
      ? `SELECT id, code, title, parent_id, specific_code_id, is_active FROM detail_levels WHERE parent_id = $1 ORDER BY code`
      : `SELECT id, code, title, parent_id, specific_code_id, is_active FROM detail_levels WHERE parent_id IS NULL ORDER BY code`;
    const r = parentId ? await p.query(sql, [parentId]) : await p.query(sql);
    return res.json({ items: r.rows, message: t('detailLevels.list', lang) });
  } catch (e) {
    console.error('detailLevels GET /children failed:', e);
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * GET /:id - Fetch one detail level by id.
 */
detailLevelsRouter.get('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    const p = getPool();
    const r = await p.query(
      `SELECT id, code, title, parent_id, specific_code_id, is_active FROM detail_levels WHERE id = $1`,
      [id]
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: t('detailLevels.notFound', lang) });
    return res.json({ item: r.rows[0], message: t('detailLevels.fetchOne', lang) });
  } catch (e) {
    console.error('detailLevels GET /:id failed:', e);
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * POST / - Create a detail level.
 * Enforces linking rules: root must have `specific_code_id`; non-root must not.
 * Validates uniqueness of `code` and specific-kind requirement.
 */
detailLevelsRouter.post('/', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const parse = createSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { code, title, parent_id, specific_code_id, is_active } = parse.data;

  // Linking rules
  if (!parent_id && !specific_code_id) {
    return res.status(400).json({ ok: false, error: t('detailLevels.specificRequired', lang) });
  }
  if (parent_id && specific_code_id) {
    return res.status(400).json({ ok: false, error: t('detailLevels.rootOnlyLink', lang) });
  }
  if (!parent_id && specific_code_id) {
    const okSpecific = await ensureSpecificKind(specific_code_id);
    if (!okSpecific) {
      return res.status(400).json({ ok: false, error: t('detailLevels.specificRequired', lang) });
    }
  }

  const id = require('crypto').randomUUID();
  try {
    const p = getPool();
    const dup = await p.query(`SELECT id FROM detail_levels WHERE code = $1`, [code]);
    if ((dup.rowCount || 0) > 0) return res.status(409).json({ ok: false, error: t('detailLevels.duplicateCode', lang) });
    await p.query(
      `INSERT INTO detail_levels (id, code, title, parent_id, specific_code_id, is_active) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, code, title, parent_id || null, specific_code_id || null, is_active ?? true]
    );
    return res.status(201).json({ id, message: t('detailLevels.created', lang) });
  } catch (e) {
    console.error('detailLevels POST / failed:', e);
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * PATCH /:id - Update a detail level.
 * Validates unique `code`, detects cycles, enforces linking rules, and updates `updated_at`.
 */
detailLevelsRouter.patch('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  const parse = updateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang), details: parse.error.issues });
  const { code, title, parent_id, specific_code_id, is_active } = parse.data;

  try {
    const p = getPool();
    const existing = await p.query(
      `SELECT id, code, title, parent_id, specific_code_id, is_active FROM detail_levels WHERE id = $1`,
      [id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ ok: false, error: t('detailLevels.notFound', lang) });

    if (code) {
      const dup = await p.query(`SELECT id FROM detail_levels WHERE code = $1 AND id <> $2`, [code, id]);
      if ((dup.rowCount || 0) > 0) return res.status(409).json({ ok: false, error: t('detailLevels.duplicateCode', lang) });
    }

    if (parent_id && (await wouldCreateCycle(parent_id, id))) {
      return res.status(400).json({ ok: false, error: t('detailLevels.cycle', lang) });
    }

    const row = existing.rows[0];
    const nextParent = parent_id !== undefined ? (parent_id || null) : row.parent_id;
    const nextCode = code !== undefined ? code : row.code;
    const nextTitle = title !== undefined ? title : row.title;
    const nextSpecific = specific_code_id !== undefined ? (specific_code_id || null) : row.specific_code_id;

    // Linking rules on next state
    if (!nextParent && !nextSpecific) {
      return res.status(400).json({ ok: false, error: t('detailLevels.specificRequired', lang) });
    }
    if (nextParent && nextSpecific) {
      return res.status(400).json({ ok: false, error: t('detailLevels.rootOnlyLink', lang) });
    }
    if (!nextParent && nextSpecific) {
      const okSpecific = await ensureSpecificKind(nextSpecific);
      if (!okSpecific) {
        return res.status(400).json({ ok: false, error: t('detailLevels.specificRequired', lang) });
      }
    }

    const nextActive = is_active !== undefined ? is_active : row.is_active;

    await p.query(
      `UPDATE detail_levels SET code = $1, title = $2, parent_id = $3, specific_code_id = $4, is_active = $5, updated_at = NOW() WHERE id = $6`,
      [nextCode, nextTitle, nextParent, nextSpecific, nextActive, id]
    );
    return res.json({ id, message: t('detailLevels.updated', lang) });
  } catch (e) {
    console.error('detailLevels PATCH /:id failed:', e);
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * DELETE /:id - Delete only when the node has no children and no links to details.
 * Returns localized conflict when children exist or links present in join table.
 */
detailLevelsRouter.delete('/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const { id } = req.params;
  try {
    const p = getPool();
    const child = await p.query(`SELECT id FROM detail_levels WHERE parent_id = $1 LIMIT 1`, [id]);
    if ((child.rowCount || 0) > 0) return res.status(409).json({ ok: false, error: t('detailLevels.hasChildren', lang) });
    const linked = await p.query(`SELECT 1 FROM details_detail_levels WHERE detail_level_id = $1 LIMIT 1`, [id]);
    if ((linked.rowCount || 0) > 0) return res.status(409).json({ ok: false, error: t('detailLevels.linkedExists', lang) });
    const r = await p.query(`DELETE FROM detail_levels WHERE id = $1`, [id]);
    if ((r.rowCount || 0) === 0) return res.status(404).json({ ok: false, error: t('detailLevels.notFound', lang) });
    return res.json({ id, message: t('detailLevels.deleted', lang) });
  } catch (e) {
    console.error('detailLevels DELETE /:id failed:', e);
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});

/**
 * GET /children?parentId=... - List children of a node or roots.
 * Supports `parentId` query; returns ordered by `code`.
 */
detailLevelsRouter.get('/children', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const parentId = String(req.query.parentId || '') || null;
  try {
    const p = getPool();
    const sql = parentId
      ? `SELECT id, code, title, parent_id, specific_code_id, is_active FROM detail_levels WHERE parent_id = $1 ORDER BY code`
      : `SELECT id, code, title, parent_id, specific_code_id, is_active FROM detail_levels WHERE parent_id IS NULL ORDER BY code`;
    const r = parentId ? await p.query(sql, [parentId]) : await p.query(sql);
    return res.json({ items: r.rows, message: t('detailLevels.list', lang) });
  } catch {
    return res.status(500).json({ ok: false, error: t('error.generic', lang) });
  }
});