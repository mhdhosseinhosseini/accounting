"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detailsRouter = void 0;
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const i18n_1 = require("../i18n");
const auth_1 = require("../middleware/auth");
const pg_1 = require("../db/pg");
/**
 * Router for Details CRUD and code suggestion.
 * Postgres-only implementation. Details are global 4-digit codes.
 */
exports.detailsRouter = express_1.default.Router();
// All routes require authentication
exports.detailsRouter.use(auth_1.requireAuth);
/** Validate that a detail code is exactly four digits without any prefix. */
function isValidDetailCode(code) {
    return /^\d{4}$/.test(code);
}
/**
 * Helper: check if a detail_level id refers to a leaf node (no children).
 * Leaf-only linking is enforced for reporting clarity.
 */
async function isLeafDetailLevel(id) {
    const p = (0, pg_1.getPool)();
    const r = await p.query(`SELECT 1 FROM detail_levels WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM detail_levels WHERE parent_id = $1)`, [id]);
    return (r.rowCount || 0) > 0;
}
/**
 * Zod schemas for create/update requests.
 */
const linkItemSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    is_primary: zod_1.z.boolean().optional(),
    position: zod_1.z.number().int().nonnegative().optional(),
});
const detailCreateSchema = zod_1.z.object({
    code: zod_1.z.string().min(1),
    title: zod_1.z.string().min(1),
    is_active: zod_1.z.boolean().optional(),
    detail_levels: zod_1.z.array(linkItemSchema).optional(),
    detail_level_ids: zod_1.z.array(zod_1.z.string().min(1)).optional(),
});
const detailUpdateSchema = zod_1.z.object({
    code: zod_1.z.string().min(1).optional(),
    title: zod_1.z.string().min(1).optional(),
    is_active: zod_1.z.boolean().optional(),
    detail_levels: zod_1.z.array(linkItemSchema).optional(),
    detail_level_ids: zod_1.z.array(zod_1.z.string().min(1)).optional(),
});
/**
 * GET / - List all details.
 * Returns items ordered by code.
 */
exports.detailsRouter.get('/', async (req, res) => {
    const lang = req.lang || 'en';
    try {
        const p = (0, pg_1.getPool)();
        const r = await p.query(`SELECT id, code, title, is_active, kind FROM details ORDER BY code`);
        return res.json({ items: r.rows, message: (0, i18n_1.t)('details.list', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * GET /suggest-next - Suggest the next available 4-digit code (Postgres-only).
 * Finds the smallest unused code in the 0001..9999 range.
 */
exports.detailsRouter.get('/suggest-next', async (req, res) => {
    const lang = req.lang || 'en';
    try {
        const p = (0, pg_1.getPool)();
        const r = await p.query(`SELECT code FROM details`);
        const existingCodes = r.rows.map((x) => x.code);
        const set = new Set(existingCodes);
        let suggestion = '0001';
        for (let i = 1; i <= 9999; i++) {
            const candidate = String(i).padStart(4, '0');
            if (!set.has(candidate)) {
                suggestion = candidate;
                break;
            }
        }
        return res.json({ code: suggestion, message: (0, i18n_1.t)('details.suggested', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * GET /:id - Fetch a single detail by id.
 */
exports.detailsRouter.get('/:id', async (req, res) => {
    const lang = req.lang || 'en';
    const { id } = req.params;
    try {
        const p = (0, pg_1.getPool)();
        const r = await p.query(`SELECT id, code, title, is_active, kind FROM details WHERE id = $1`, [id]);
        if (r.rowCount === 0)
            return res.status(404).json({ ok: false, error: (0, i18n_1.t)('details.notFound', lang) });
        return res.json({ item: r.rows[0], message: (0, i18n_1.t)('details.fetchOne', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * GET /:id/detail-levels - List linked detail levels for a detail.
 * Includes is_primary and position, ordered by position then code.
 */
exports.detailsRouter.get('/:id/detail-levels', async (req, res) => {
    const lang = req.lang || 'en';
    const { id } = req.params;
    try {
        const p = (0, pg_1.getPool)();
        const r = await p.query(`SELECT dl.id, dl.code, dl.title, l.is_primary, l.position
       FROM details_detail_levels l
       JOIN detail_levels dl ON dl.id = l.detail_level_id
       WHERE l.detail_id = $1
       ORDER BY l.position NULLS LAST, dl.code`, [id]);
        return res.json({ items: r.rows, message: (0, i18n_1.t)('details.linksFetched', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * POST / - Create a new detail and optional links to detail_levels.
 * Enforces 4-digit width, uniqueness, and leaf-only linking when provided.
 */
exports.detailsRouter.post('/', async (req, res) => {
    const lang = req.lang || 'en';
    const parse = detailCreateSchema.safeParse(req.body);
    if (!parse.success)
        return res.status(400).json({ ok: false, error: (0, i18n_1.t)('error.invalidInput', lang), details: parse.error.issues });
    const { code, title, is_active, detail_levels, detail_level_ids } = parse.data;
    if (!isValidDetailCode(code)) {
        return res.status(400).json({ ok: false, error: (0, i18n_1.t)('details.invalidWidth', lang) });
    }
    const id = require('crypto').randomUUID();
    try {
        const p = (0, pg_1.getPool)();
        const dup = await p.query(`SELECT id FROM details WHERE code = $1`, [code]);
        if ((dup.rowCount || 0) > 0)
            return res.status(409).json({ ok: false, error: (0, i18n_1.t)('details.duplicateCode', lang) });
        // Create detail row (UI-defined => kind = TRUE)
        await p.query(`INSERT INTO details (id, code, title, is_active, kind) VALUES ($1, $2, $3, $4, TRUE)`, [id, code, title, is_active ?? true]);
        // Normalize links from either field
        const normalized = (detail_levels && detail_levels.length > 0)
            ? detail_levels.map(it => ({ id: it.id, is_primary: !!it.is_primary, position: it.position ?? null }))
            : (detail_level_ids || []).map((x, i) => ({ id: x, is_primary: false, position: null }));
        // Insert links if provided
        if (normalized.length > 0) {
            // De-duplicate by id
            const seen = new Set();
            for (const it of normalized) {
                if (seen.has(it.id))
                    continue;
                seen.add(it.id);
                // Enforce leaf-only
                const isLeaf = await isLeafDetailLevel(it.id);
                if (!isLeaf) {
                    return res.status(400).json({ ok: false, error: (0, i18n_1.t)('details.linkMustBeLeaf', lang) });
                }
                await p.query(`INSERT INTO details_detail_levels (detail_id, detail_level_id, is_primary, position)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (detail_id, detail_level_id) DO UPDATE SET is_primary = EXCLUDED.is_primary, position = EXCLUDED.position`, [id, it.id, it.is_primary ? true : false, it.position]);
            }
        }
        return res.status(201).json({ id, message: (0, i18n_1.t)('details.created', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * PATCH /:id - Update a detail and optionally replace links.
 * Validates code format and uniqueness; when links provided, replaces atomically.
 */
exports.detailsRouter.patch('/:id', async (req, res) => {
    const lang = req.lang || 'en';
    const { id } = req.params;
    const parse = detailUpdateSchema.safeParse(req.body);
    if (!parse.success)
        return res.status(400).json({ ok: false, error: (0, i18n_1.t)('error.invalidInput', lang), details: parse.error.issues });
    const { code, title, is_active, detail_levels, detail_level_ids } = parse.data;
    if (code !== undefined && !isValidDetailCode(code)) {
        return res.status(400).json({ ok: false, error: (0, i18n_1.t)('details.invalidWidth', lang) });
    }
    try {
        const p = (0, pg_1.getPool)();
        const existing = await p.query(`SELECT id, kind FROM details WHERE id = $1`, [id]);
        if (existing.rowCount === 0)
            return res.status(404).json({ ok: false, error: (0, i18n_1.t)('details.notFound', lang) });
        const isSystemManaged = existing.rows[0]?.kind === false;
        if (isSystemManaged) {
            return res.status(403).json({ ok: false, error: (0, i18n_1.t)('details.systemManagedCannotEdit', lang) });
        }
        if (code) {
            const dup = await p.query(`SELECT id FROM details WHERE code = $1 AND id <> $2`, [code, id]);
            if ((dup.rowCount || 0) > 0)
                return res.status(409).json({ ok: false, error: (0, i18n_1.t)('details.duplicateCode', lang) });
        }
        await p.query(`UPDATE details SET code = COALESCE($1, code), title = COALESCE($2, title), is_active = COALESCE($3, is_active) WHERE id = $4 RETURNING id`, [code ?? null, title ?? null, is_active ?? null, id]);
        // If links provided, replace atomically
        const normalized = (detail_levels && detail_levels.length > 0)
            ? detail_levels.map(it => ({ id: it.id, is_primary: !!it.is_primary, position: it.position ?? null }))
            : (detail_level_ids || []).map((x, i) => ({ id: x, is_primary: false, position: null }));
        if (normalized.length > 0) {
            await p.query('BEGIN');
            await p.query(`DELETE FROM details_detail_levels WHERE detail_id = $1`, [id]);
            const seen = new Set();
            for (const it of normalized) {
                if (seen.has(it.id))
                    continue;
                seen.add(it.id);
                const isLeaf = await isLeafDetailLevel(it.id);
                if (!isLeaf) {
                    await p.query('ROLLBACK');
                    return res.status(400).json({ ok: false, error: (0, i18n_1.t)('details.linkMustBeLeaf', lang) });
                }
                await p.query(`INSERT INTO details_detail_levels (detail_id, detail_level_id, is_primary, position)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (detail_id, detail_level_id) DO UPDATE SET is_primary = EXCLUDED.is_primary, position = EXCLUDED.position`, [id, it.id, it.is_primary ? true : false, it.position]);
            }
            await p.query('COMMIT');
        }
        return res.json({ id, message: (0, i18n_1.t)('details.updated', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * DELETE /:id - Delete a detail only when no links exist.
 * Returns conflict when linked to any detail_levels.
 */
exports.detailsRouter.delete('/:id', async (req, res) => {
    const lang = req.lang || 'en';
    const { id } = req.params;
    try {
        const p = (0, pg_1.getPool)();
        const existing = await p.query(`SELECT kind FROM details WHERE id = $1`, [id]);
        if (existing.rowCount === 0)
            return res.status(404).json({ ok: false, error: (0, i18n_1.t)('details.notFound', lang) });
        if (existing.rows[0]?.kind === false)
            return res.status(403).json({ ok: false, error: (0, i18n_1.t)('details.systemManagedCannotDelete', lang) });
        const link = await p.query(`SELECT 1 FROM details_detail_levels WHERE detail_id = $1 LIMIT 1`, [id]);
        if ((link.rowCount || 0) > 0)
            return res.status(409).json({ ok: false, error: (0, i18n_1.t)('details.linkedExists', lang) });
        const r = await p.query(`DELETE FROM details WHERE id = $1`, [id]);
        if ((r.rowCount || 0) === 0)
            return res.status(404).json({ ok: false, error: (0, i18n_1.t)('details.notFound', lang) });
        return res.json({ id, message: (0, i18n_1.t)('details.deleted', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * GET /suggest-next - Suggest the next available 4-digit code (Postgres-only).
 * Finds the smallest unused code in the 0001..9999 range.
 */
exports.detailsRouter.get('/suggest-next', async (req, res) => {
    const lang = req.lang || 'en';
    try {
        const p = (0, pg_1.getPool)();
        const r = await p.query(`SELECT code FROM details`);
        const existingCodes = r.rows.map((x) => x.code);
        const set = new Set(existingCodes);
        let suggestion = '0001';
        for (let i = 1; i <= 9999; i++) {
            const candidate = String(i).padStart(4, '0');
            if (!set.has(candidate)) {
                suggestion = candidate;
                break;
            }
        }
        return res.json({ code: suggestion, message: (0, i18n_1.t)('details.suggested', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
