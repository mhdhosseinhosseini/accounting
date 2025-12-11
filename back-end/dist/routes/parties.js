"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.partiesRouter = void 0;
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const i18n_1 = require("../i18n");
const auth_1 = require("../middleware/auth");
const pg_1 = require("../db/pg");
/**
 * Router for parties CRUD.
 * Postgres-only implementation.
 */
exports.partiesRouter = express_1.default.Router();
// All routes require authentication
exports.partiesRouter.use(auth_1.requireAuth);
/** Zod schema for party creation. */
const partyCreateSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    code: zod_1.z.string().optional(),
    mobile: zod_1.z.string().optional(),
    address: zod_1.z.string().optional(),
});
/** Zod schema for party update. */
const partyUpdateSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).optional(),
    code: zod_1.z.string().optional(),
    mobile: zod_1.z.string().optional(),
    address: zod_1.z.string().optional(),
});
/**
 * GET / - List parties.
 */
exports.partiesRouter.get('/', async (req, res) => {
    const lang = req.lang || 'en';
    try {
        // Postgres-only list implementation
        const p = (0, pg_1.getPool)();
        const r = await p.query(`SELECT id, name, code, mobile, address FROM parties ORDER BY name`);
        return res.json({ items: r.rows, message: (0, i18n_1.t)('parties.list', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * POST / - Create a party.
 */
exports.partiesRouter.post('/', async (req, res) => {
    const lang = req.lang || 'en';
    const parse = partyCreateSchema.safeParse(req.body);
    if (!parse.success)
        return res.status(400).json({ ok: false, error: (0, i18n_1.t)('error.invalidInput', lang), details: parse.error.issues });
    const { name, code, mobile, address } = parse.data;
    const id = require('crypto').randomUUID();
    try {
        // Postgres-only create implementation
        const p = (0, pg_1.getPool)();
        if (code) {
            const dup = await p.query(`SELECT id FROM parties WHERE code = $1`, [code]);
            if ((dup.rowCount || 0) > 0)
                return res.status(409).json({ ok: false, error: (0, i18n_1.t)('parties.duplicateCode', lang) });
        }
        await p.query(`INSERT INTO parties (id, name, code, mobile, address) VALUES ($1, $2, $3, $4, $5)`, [id, name, code ?? null, mobile ?? null, address ?? null]);
        return res.status(201).json({ id, message: (0, i18n_1.t)('parties.created', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * PATCH /:id - Update a party.
 */
exports.partiesRouter.patch('/:id', async (req, res) => {
    const lang = req.lang || 'en';
    const { id } = req.params;
    const parse = partyUpdateSchema.safeParse(req.body);
    if (!parse.success)
        return res.status(400).json({ ok: false, error: (0, i18n_1.t)('error.invalidInput', lang), details: parse.error.issues });
    const { name, code, mobile, address } = parse.data;
    try {
        // Postgres-only update implementation
        const p = (0, pg_1.getPool)();
        const exist = await p.query(`SELECT id FROM parties WHERE id = $1`, [id]);
        if (exist.rowCount === 0)
            return res.status(404).json({ ok: false, error: (0, i18n_1.t)('parties.notFound', lang) });
        if (code) {
            const dup = await p.query(`SELECT id FROM parties WHERE code = $1 AND id <> $2`, [code, id]);
            if ((dup.rowCount || 0) > 0)
                return res.status(409).json({ ok: false, error: (0, i18n_1.t)('parties.duplicateCode', lang) });
        }
        const r = await p.query(`UPDATE parties SET name = COALESCE($1, name), code = COALESCE($2, code), mobile = COALESCE($3, mobile), address = COALESCE($4, address) WHERE id = $5 RETURNING id`, [name ?? null, code ?? null, mobile ?? null, address ?? null, id]);
        if (r.rowCount === 0)
            return res.status(404).json({ ok: false, error: (0, i18n_1.t)('parties.notFound', lang) });
        return res.json({ id, message: (0, i18n_1.t)('parties.updated', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * DELETE /:id - Delete a party.
 */
exports.partiesRouter.delete('/:id', async (req, res) => {
    const lang = req.lang || 'en';
    const { id } = req.params;
    try {
        // Postgres-only delete implementation
        const p = (0, pg_1.getPool)();
        const r = await p.query(`DELETE FROM parties WHERE id = $1`, [id]);
        if ((r.rowCount || 0) === 0)
            return res.status(404).json({ ok: false, error: (0, i18n_1.t)('parties.notFound', lang) });
        return res.json({ id, message: (0, i18n_1.t)('parties.deleted', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
