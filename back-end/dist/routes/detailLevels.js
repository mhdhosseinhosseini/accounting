"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detailLevelsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const i18n_1 = require("../i18n");
const auth_1 = require("../middleware/auth");
const pg_1 = require("../db/pg");
/**
 * Router: Detail Levels
 * Implements hierarchical detail levels with self-referencing parent.
 * Supports optional association to multiple 'specific' codes via `specific_code_ids`.
 * Postgres-only implementation under /api/v1/detail-levels.
 */
exports.detailLevelsRouter = (0, express_1.Router)();
// Require authentication for all endpoints
exports.detailLevelsRouter.use(auth_1.requireAuth);
/**
 * Zod schema: Create request payload.
 * Enforces required fields and optional nullable parent/specific linkage.
 */
const createSchema = zod_1.z.object({
    code: zod_1.z.string().min(1),
    title: zod_1.z.string().min(1),
    parent_id: zod_1.z.string().min(1).nullable().optional(),
    specific_code_ids: zod_1.z.array(zod_1.z.string().min(1)).optional(),
    is_active: zod_1.z.boolean().optional(),
});
/**
 * Zod schema: Update request payload.
 * Allows partial updates of fields.
 */
const updateSchema = zod_1.z.object({
    code: zod_1.z.string().min(1).optional(),
    title: zod_1.z.string().min(1).optional(),
    parent_id: zod_1.z.string().min(1).nullable().optional(),
    specific_code_ids: zod_1.z.array(zod_1.z.string().min(1)).optional(),
    is_active: zod_1.z.boolean().optional(),
});
/**
 * Helper: Detect if assigning `candidateParentId` to `selfId` would create a cycle.
 * Walks ancestors via `parent_id` up to a bounded depth to detect loops.
 */
async function wouldCreateCycle(candidateParentId, selfId) {
    if (!candidateParentId)
        return false;
    if (candidateParentId === selfId)
        return true;
    const p = (0, pg_1.getPool)();
    let cur = candidateParentId;
    for (let i = 0; i < 512; i++) {
        const r = await p.query(`SELECT parent_id FROM detail_levels WHERE id = $1`, [cur]);
        if (r.rowCount === 0)
            return false;
        const next = r.rows[0].parent_id;
        if (!next)
            return false;
        if (String(next) === String(selfId))
            return true;
        cur = String(next);
    }
    return false;
}
/**
 * Helper: Verify that a given `codeId` refers to a 'specific' code.
 * If the `codes` table is unavailable, returns true to avoid hard failure.
 */
async function ensureSpecificKind(codeId) {
    if (!codeId)
        return true;
    try {
        const p = (0, pg_1.getPool)();
        const probe = await p.query("SELECT to_regclass('public.codes') AS exists");
        if (!probe.rows[0] || !probe.rows[0].exists)
            return true;
        const r = await p.query('SELECT kind FROM codes WHERE id = $1', [codeId]);
        return (r.rowCount || 0) > 0 && String(r.rows[0].kind) === 'specific';
    }
    catch {
        return true;
    }
}
/**
 * GET / - List all detail levels (flat).
 * Returns `id, code, title, parent_id, specific_code_ids, is_active`.
 */
exports.detailLevelsRouter.get('/', async (req, res) => {
    const lang = req.lang || 'en';
    try {
        const p = (0, pg_1.getPool)();
        const r = await p.query(`SELECT id, code, title, parent_id, is_active FROM detail_levels ORDER BY code`);
        const c = await p.query(`SELECT detail_level_id, array_agg(code_id) AS specific_code_ids
       FROM detail_level_specific_codes
       GROUP BY detail_level_id`);
        const codesMap = new Map();
        for (const row of c.rows) {
            codesMap.set(String(row.detail_level_id), (row.specific_code_ids || []));
        }
        const items = r.rows.map((row) => ({
            ...row,
            specific_code_ids: codesMap.get(String(row.id)) || [],
        }));
        return res.json({ items, message: (0, i18n_1.t)('detailLevels.list', lang) });
    }
    catch (e) {
        console.error('detailLevels GET / failed:', e);
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * GET /tree - Full tree of detail levels.
 * Builds nested children arrays by `parent_id` linkage.
 */
exports.detailLevelsRouter.get('/tree', async (req, res) => {
    const lang = req.lang || 'en';
    try {
        const p = (0, pg_1.getPool)();
        const r = await p.query(`SELECT id, code, title, parent_id, is_active FROM detail_levels ORDER BY code`);
        const c = await p.query(`SELECT detail_level_id, array_agg(code_id) AS specific_code_ids
       FROM detail_level_specific_codes
       GROUP BY detail_level_id`);
        const codesMap = new Map();
        for (const row of c.rows) {
            codesMap.set(String(row.detail_level_id), (row.specific_code_ids || []));
        }
        const rows = r.rows.map((row) => ({
            ...row,
            specific_code_ids: codesMap.get(String(row.id)) || [],
        }));
        const byId = new Map();
        const roots = [];
        rows.forEach((r) => {
            byId.set(r.id, { ...r, children: [] });
        });
        rows.forEach((r) => {
            const node = byId.get(r.id);
            const pid = r.parent_id || null;
            if (pid && byId.has(pid)) {
                byId.get(pid).children.push(node);
            }
            else {
                roots.push(node);
            }
        });
        return res.json({ items: roots, message: (0, i18n_1.t)('detailLevels.tree', lang) });
    }
    catch (e) {
        console.error('detailLevels GET /tree failed:', e);
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * GET /children?parentId=... - List children of a node or roots.
 * Placed before `/:id` to ensure correct routing order in Express.
 * Returns children ordered by `code`; without `parentId` returns roots.
 */
exports.detailLevelsRouter.get('/children', async (req, res) => {
    const lang = req.lang || 'en';
    const parentId = String(req.query.parentId || '') || null;
    try {
        const p = (0, pg_1.getPool)();
        const sql = parentId
            ? `SELECT id, code, title, parent_id, is_active FROM detail_levels WHERE parent_id = $1 ORDER BY code`
            : `SELECT id, code, title, parent_id, is_active FROM detail_levels WHERE parent_id IS NULL ORDER BY code`;
        const r = parentId ? await p.query(sql, [parentId]) : await p.query(sql);
        const c = await p.query(`SELECT detail_level_id, array_agg(code_id) AS specific_code_ids
       FROM detail_level_specific_codes
       GROUP BY detail_level_id`);
        const codesMap = new Map();
        for (const row of c.rows) {
            codesMap.set(String(row.detail_level_id), (row.specific_code_ids || []));
        }
        const items = r.rows.map((row) => ({
            ...row,
            specific_code_ids: codesMap.get(String(row.id)) || [],
        }));
        return res.json({ items, message: (0, i18n_1.t)('detailLevels.list', lang) });
    }
    catch (e) {
        console.error('detailLevels GET /children failed:', e);
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * GET /:id - Fetch one detail level by id.
 */
exports.detailLevelsRouter.get('/:id', async (req, res) => {
    const lang = req.lang || 'en';
    const { id } = req.params;
    try {
        const p = (0, pg_1.getPool)();
        const r = await p.query(`SELECT id, code, title, parent_id, is_active FROM detail_levels WHERE id = $1`, [id]);
        if (r.rowCount === 0)
            return res.status(404).json({ ok: false, error: (0, i18n_1.t)('detailLevels.notFound', lang) });
        const c = await p.query(`SELECT code_id FROM detail_level_specific_codes WHERE detail_level_id = $1`, [id]);
        const specific_code_ids = c.rows.map((row) => String(row.code_id));
        const item = { ...r.rows[0], specific_code_ids };
        return res.json({ item, message: (0, i18n_1.t)('detailLevels.fetchOne', lang) });
    }
    catch (e) {
        console.error('detailLevels GET /:id failed:', e);
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * POST / - Create a detail level.
 * Accepts optional `specific_code_ids` array and persists to join table.
 * Validates uniqueness of `code` and specific-kind requirement.
 */
exports.detailLevelsRouter.post('/', async (req, res) => {
    const lang = req.lang || 'en';
    const parse = createSchema.safeParse(req.body);
    if (!parse.success)
        return res.status(400).json({ ok: false, error: (0, i18n_1.t)('error.invalidInput', lang), details: parse.error.issues });
    const { code, title, parent_id, specific_code_ids, is_active } = parse.data;
    const id = require('crypto').randomUUID();
    try {
        const p = (0, pg_1.getPool)();
        const dup = await p.query(`SELECT id FROM detail_levels WHERE code = $1`, [code]);
        if ((dup.rowCount || 0) > 0)
            return res.status(409).json({ ok: false, error: (0, i18n_1.t)('detailLevels.duplicateCode', lang) });
        await p.query(`INSERT INTO detail_levels (id, code, title, parent_id, is_active) VALUES ($1, $2, $3, $4, $5)`, [id, code, title, parent_id || null, is_active ?? true]);
        if (specific_code_ids && specific_code_ids.length > 0) {
            for (const cid of specific_code_ids) {
                const okSpecific = await ensureSpecificKind(cid);
                if (!okSpecific) {
                    return res.status(400).json({ ok: false, error: (0, i18n_1.t)('detailLevels.specificRequired', lang) });
                }
                await p.query(`INSERT INTO detail_level_specific_codes (detail_level_id, code_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, cid]);
            }
        }
        return res.status(201).json({ id, message: (0, i18n_1.t)('detailLevels.created', lang) });
    }
    catch (e) {
        console.error('detailLevels POST / failed:', e);
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * PATCH /:id - Update a detail level.
 * Validates unique `code`, detects cycles, enforces linking rules, and updates `updated_at`.
 */
exports.detailLevelsRouter.patch('/:id', async (req, res) => {
    const lang = req.lang || 'en';
    const { id } = req.params;
    const parse = updateSchema.safeParse(req.body);
    if (!parse.success)
        return res.status(400).json({ ok: false, error: (0, i18n_1.t)('error.invalidInput', lang), details: parse.error.issues });
    const { code, title, parent_id, specific_code_ids, is_active } = parse.data;
    try {
        const p = (0, pg_1.getPool)();
        const existing = await p.query(`SELECT id, code, title, parent_id, is_active FROM detail_levels WHERE id = $1`, [id]);
        if (existing.rowCount === 0)
            return res.status(404).json({ ok: false, error: (0, i18n_1.t)('detailLevels.notFound', lang) });
        if (code) {
            const dup = await p.query(`SELECT id FROM detail_levels WHERE code = $1 AND id <> $2`, [code, id]);
            if ((dup.rowCount || 0) > 0)
                return res.status(409).json({ ok: false, error: (0, i18n_1.t)('detailLevels.duplicateCode', lang) });
        }
        if (parent_id && (await wouldCreateCycle(parent_id, id))) {
            return res.status(400).json({ ok: false, error: (0, i18n_1.t)('detailLevels.cycle', lang) });
        }
        const row = existing.rows[0];
        const nextParent = parent_id !== undefined ? (parent_id || null) : row.parent_id;
        const nextCode = code !== undefined ? code : row.code;
        const nextTitle = title !== undefined ? title : row.title;
        const nextActive = is_active !== undefined ? is_active : row.is_active;
        await p.query(`UPDATE detail_levels SET code = $1, title = $2, parent_id = $3, is_active = $4, updated_at = NOW() WHERE id = $5`, [nextCode, nextTitle, nextParent, nextActive, id]);
        if (specific_code_ids !== undefined) {
            await p.query(`DELETE FROM detail_level_specific_codes WHERE detail_level_id = $1`, [id]);
            if (specific_code_ids && specific_code_ids.length > 0) {
                for (const cid of specific_code_ids) {
                    const okSpecific = await ensureSpecificKind(cid);
                    if (!okSpecific) {
                        return res.status(400).json({ ok: false, error: (0, i18n_1.t)('detailLevels.specificRequired', lang) });
                    }
                    await p.query(`INSERT INTO detail_level_specific_codes (detail_level_id, code_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, cid]);
                }
            }
        }
        return res.json({ id, message: (0, i18n_1.t)('detailLevels.updated', lang) });
    }
    catch (e) {
        console.error('detailLevels PATCH /:id failed:', e);
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * DELETE /:id - Delete only when the node has no children and no links to details.
 * Returns localized conflict when children exist or links present in join table.
 */
exports.detailLevelsRouter.delete('/:id', async (req, res) => {
    const lang = req.lang || 'en';
    const { id } = req.params;
    try {
        const p = (0, pg_1.getPool)();
        const child = await p.query(`SELECT id FROM detail_levels WHERE parent_id = $1 LIMIT 1`, [id]);
        if ((child.rowCount || 0) > 0)
            return res.status(409).json({ ok: false, error: (0, i18n_1.t)('detailLevels.hasChildren', lang) });
        const linked = await p.query(`SELECT 1 FROM details_detail_levels WHERE detail_level_id = $1 LIMIT 1`, [id]);
        if ((linked.rowCount || 0) > 0)
            return res.status(409).json({ ok: false, error: (0, i18n_1.t)('detailLevels.linkedExists', lang) });
        const r = await p.query(`DELETE FROM detail_levels WHERE id = $1`, [id]);
        if ((r.rowCount || 0) === 0)
            return res.status(404).json({ ok: false, error: (0, i18n_1.t)('detailLevels.notFound', lang) });
        return res.json({ id, message: (0, i18n_1.t)('detailLevels.deleted', lang) });
    }
    catch (e) {
        console.error('detailLevels DELETE /:id failed:', e);
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * GET /children?parentId=... - List children of a node or roots.
 * Supports `parentId` query; returns ordered by `code`.
 */
exports.detailLevelsRouter.get('/children', async (req, res) => {
    const lang = req.lang || 'en';
    const parentId = String(req.query.parentId || '') || null;
    try {
        const p = (0, pg_1.getPool)();
        const sql = parentId
            ? `SELECT id, code, title, parent_id, is_active FROM detail_levels WHERE parent_id = $1 ORDER BY code`
            : `SELECT id, code, title, parent_id, is_active FROM detail_levels WHERE parent_id IS NULL ORDER BY code`;
        const r = parentId ? await p.query(sql, [parentId]) : await p.query(sql);
        const c = await p.query(`SELECT detail_level_id, array_agg(code_id) AS specific_code_ids
       FROM detail_level_specific_codes
       GROUP BY detail_level_id`);
        const codesMap = new Map();
        for (const row of c.rows) {
            codesMap.set(String(row.detail_level_id), (row.specific_code_ids || []));
        }
        const items = r.rows.map((row) => ({
            ...row,
            specific_code_ids: codesMap.get(String(row.id)) || [],
        }));
        return res.json({ items, message: (0, i18n_1.t)('detailLevels.list', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
