"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const pg_1 = require("../db/pg");
const crypto_1 = require("crypto");
const i18n_1 = require("../i18n");
/**
 * Codes router: implements General → Specific codes with tree endpoint.
 * Postgres-only implementation.
 */
const codesRouter = (0, express_1.Router)();
/**
 * Parse and validate nature field.
 * Accepts 0 (Debitor), 1 (Creditor), or null/undefined for None.
 */
function parseNature(n) {
    if (n === undefined || n === null || n === '')
        return null;
    const num = Number(n);
    if (Number.isNaN(num))
        return null;
    if (num === 0 || num === 1)
        return num;
    return null;
}
/**
 * Validate code payload. Enforces kind and basic fields.
 */
function validatePayload(body) {
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
codesRouter.get('/', async (req, res) => {
    const lang = req.lang || 'en';
    try {
        const p = (0, pg_1.getPool)();
        const { rows } = await p.query('SELECT * FROM codes ORDER BY kind ASC, code ASC');
        return res.json({ message: (0, i18n_1.t)('codes.list', lang), data: rows });
    }
    catch {
        return res.status(500).json({ message: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * GET /api/v1/codes/tree
 * Build a tree: Generals at root, Specifics under their parent.
 * Postgres-only implementation.
 */
codesRouter.get('/tree', async (req, res) => {
    const lang = req.lang || 'en';
    try {
        const p = (0, pg_1.getPool)();
        const result = await p.query('SELECT * FROM codes ORDER BY kind ASC, code ASC');
        const rows = result.rows;
        const groups = rows.filter((r) => r.kind === 'group');
        const generals = rows.filter((r) => r.kind === 'general');
        const specifics = rows.filter((r) => r.kind === 'specific');
        const generalsByGroup = {};
        for (const g of generals) {
            const pid = g.parent_id || '__root__';
            generalsByGroup[pid] = generalsByGroup[pid] || [];
            generalsByGroup[pid].push(g);
        }
        const specificsByGeneral = {};
        for (const sp of specifics) {
            const pid = sp.parent_id || '__root__';
            specificsByGeneral[pid] = specificsByGeneral[pid] || [];
            specificsByGeneral[pid].push(sp);
        }
        const tree = groups.map((grp) => ({
            ...grp,
            children: (generalsByGroup[grp.id] || []).map((gen) => ({
                ...gen,
                children: specificsByGeneral[gen.id] || [],
            })),
        }));
        return res.json({ message: (0, i18n_1.t)('codes.tree', lang), data: tree });
    }
    catch {
        return res.status(500).json({ message: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * GET /api/v1/codes/:id
 * Fetch a single code by id.
 */
codesRouter.get('/:id', async (req, res) => {
    const lang = req.lang || 'en';
    const id = req.params.id;
    try {
        const p = (0, pg_1.getPool)();
        const { rows } = await p.query('SELECT * FROM codes WHERE id = $1', [id]);
        if (!rows[0])
            return res.status(404).json({ message: (0, i18n_1.t)('codes.notFound', lang) });
        return res.json({ message: (0, i18n_1.t)('codes.fetchOne', lang), data: rows[0] });
    }
    catch {
        return res.status(500).json({ message: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * POST /api/v1/codes
 * Create a new code. Enforces unique code.
 */
codesRouter.post('/', async (req, res) => {
    // Create a new code (Postgres-only). Validates kind, parent relation, and uniqueness.
    const lang = req.lang || 'en';
    const payload = req.body || {};
    const valid = validatePayload(payload);
    if (!valid.ok)
        return res.status(400).json({ message: (0, i18n_1.t)(valid.error, lang) });
    const id = (0, crypto_1.randomUUID)();
    const { code, title } = payload;
    const kind = String(payload.kind).toLowerCase();
    const parentId = payload.parent_id || null;
    const isActive = payload.is_active === false ? false : true;
    const nature = parseNature(payload.nature);
    // Nature can be null (no nature). Do not enforce validation; map invalid values to null.
    try {
        const p = (0, pg_1.getPool)();
        // Relationship validation by kind
        if (kind === 'group') {
            if (parentId)
                return res.status(400).json({ message: (0, i18n_1.t)('codes.invalidParent', lang) });
        }
        else if (kind === 'general') {
            if (!parentId)
                return res.status(400).json({ message: (0, i18n_1.t)('codes.invalidParent', lang) });
            const pr = await p.query('SELECT kind FROM codes WHERE id = $1', [parentId]);
            const pk = pr.rows[0]?.kind;
            if (pk !== 'group')
                return res.status(400).json({ message: (0, i18n_1.t)('codes.invalidParent', lang) });
        }
        else if (kind === 'specific') {
            if (!parentId)
                return res.status(400).json({ message: (0, i18n_1.t)('codes.invalidParent', lang) });
            const pr = await p.query('SELECT kind FROM codes WHERE id = $1', [parentId]);
            const pk = pr.rows[0]?.kind;
            if (pk !== 'general')
                return res.status(400).json({ message: (0, i18n_1.t)('codes.invalidParent', lang) });
        }
        // Uniqueness
        const dup = await p.query('SELECT 1 FROM codes WHERE code = $1', [code]);
        if (dup.rowCount && dup.rows[0])
            return res.status(409).json({ message: (0, i18n_1.t)('codes.duplicateCode', lang) });
        // Insert (defaults: is_active=true, can_have_details=true)
        await p.query('INSERT INTO codes (id, code, title, kind, parent_id, is_active, nature, can_have_details) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, TRUE))', [id, code, title, kind, parentId, isActive, nature, (payload.can_have_details ?? null)]);
        const { rows } = await p.query('SELECT * FROM codes WHERE id = $1', [id]);
        return res.status(201).json({ message: (0, i18n_1.t)('codes.created', lang), data: rows[0] });
    }
    catch {
        return res.status(500).json({ message: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * PATCH /api/v1/codes/:id
 * Update a code by id.
 */
codesRouter.patch('/:id', async (req, res) => {
    const lang = req.lang || 'en';
    const id = req.params.id;
    const payload = req.body || {};
    if (payload.kind) {
        const kind = String(payload.kind).toLowerCase();
        if (!['group', 'general', 'specific'].includes(kind)) {
            return res.status(400).json({ message: (0, i18n_1.t)('codes.invalidKind', lang) });
        }
        // When updating to group, enforce two-digit code if provided
        if (kind === 'group' && payload.code && !/^\d{2}$/.test(String(payload.code))) {
            return res.status(400).json({ message: (0, i18n_1.t)('error.invalidInput', lang) });
        }
    }
    // Validate nature if present
    const nature = parseNature(payload.nature);
    const natureProvided = Object.prototype.hasOwnProperty.call(payload, 'nature');
    // Nature can be null or omitted. If provided with an invalid value, treat as null.
    try {
        const p = (0, pg_1.getPool)();
        const found = await p.query('SELECT * FROM codes WHERE id = $1', [id]);
        if (!found.rows[0])
            return res.status(404).json({ message: (0, i18n_1.t)('codes.notFound', lang) });
        const current = found.rows[0];
        const nextKind = payload.kind ? String(payload.kind).toLowerCase() : current.kind;
        const nextParentId = (payload.parent_id !== undefined) ? (payload.parent_id || null) : current.parent_id;
        // Relationship validation by next state
        if (nextKind === 'group') {
            if (nextParentId)
                return res.status(400).json({ message: (0, i18n_1.t)('codes.invalidParent', lang) });
        }
        else if (nextKind === 'general') {
            if (!nextParentId)
                return res.status(400).json({ message: (0, i18n_1.t)('codes.invalidParent', lang) });
            const pr = await p.query('SELECT kind FROM codes WHERE id = $1', [nextParentId]);
            const pk = pr.rows[0]?.kind;
            if (pk !== 'group')
                return res.status(400).json({ message: (0, i18n_1.t)('codes.invalidParent', lang) });
        }
        else if (nextKind === 'specific') {
            if (!nextParentId)
                return res.status(400).json({ message: (0, i18n_1.t)('codes.invalidParent', lang) });
            const pr = await p.query('SELECT kind FROM codes WHERE id = $1', [nextParentId]);
            const pk = pr.rows[0]?.kind;
            if (pk !== 'general')
                return res.status(400).json({ message: (0, i18n_1.t)('codes.invalidParent', lang) });
        }
        if (payload.code) {
            const dup = await p.query('SELECT 1 FROM codes WHERE code = $1 AND id <> $2', [payload.code, id]);
            if (dup.rowCount && dup.rows[0])
                return res.status(409).json({ message: (0, i18n_1.t)('codes.duplicateCode', lang) });
        }
        await p.query('UPDATE codes SET code = COALESCE($1, code), title = COALESCE($2, title), kind = COALESCE($3, kind), parent_id = COALESCE($4, parent_id), is_active = COALESCE($5, is_active), nature = CASE WHEN $7 = true THEN $6 ELSE nature END, can_have_details = COALESCE($8, can_have_details) WHERE id = $9', [payload.code || null, payload.title || null, payload.kind || null, (payload.parent_id ?? null), (payload.is_active ?? null), nature, natureProvided, (payload.can_have_details ?? null), id]);
        const { rows } = await p.query('SELECT * FROM codes WHERE id = $1', [id]);
        return res.json({ message: (0, i18n_1.t)('codes.updated', lang), data: rows[0] });
    }
    catch {
        return res.status(500).json({ message: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * DELETE /api/v1/codes/:id
 * Delete a code by id.
 */
codesRouter.delete('/:id', async (req, res) => {
    // Delete a code by id (Postgres-only). Verifies existence before deletion.
    const lang = req.lang || 'en';
    const id = req.params.id;
    try {
        const p = (0, pg_1.getPool)();
        const found = await p.query('SELECT 1 FROM codes WHERE id = $1', [id]);
        if (!found.rowCount)
            return res.status(404).json({ message: (0, i18n_1.t)('codes.notFound', lang) });
        await p.query('DELETE FROM codes WHERE id = $1', [id]);
        return res.json({ message: (0, i18n_1.t)('codes.deleted', lang) });
    }
    catch {
        return res.status(500).json({ message: (0, i18n_1.t)('error.generic', lang) });
    }
});
/* moved codes /tree route above /:id to prevent route shadowing */
exports.default = codesRouter;
