"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.warehousesRouter = void 0;
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const i18n_1 = require("../i18n");
const auth_1 = require("../middleware/auth");
const pg_1 = require("../db/pg");
/**
 * Router for warehouses CRUD.
 * Postgres-only implementation.
 */
exports.warehousesRouter = express_1.default.Router();
// All routes require authentication
exports.warehousesRouter.use(auth_1.requireAuth);
/** Zod schema for warehouse creation. */
const warehouseCreateSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    code: zod_1.z.string().min(1),
});
/** Zod schema for warehouse update. */
const warehouseUpdateSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).optional(),
    code: zod_1.z.string().min(1).optional(),
});
/**
 * GET / - List warehouses.
 */
exports.warehousesRouter.get('/', async (req, res) => {
    const lang = req.lang || 'en';
    try {
        const p = (0, pg_1.getPool)();
        const r = await p.query(`SELECT id, name, code FROM warehouses ORDER BY name`);
        return res.json({ items: r.rows, message: (0, i18n_1.t)('warehouses.list', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * POST / - Create a warehouse.
 */
exports.warehousesRouter.post('/', async (req, res) => {
    const lang = req.lang || 'en';
    const parse = warehouseCreateSchema.safeParse(req.body);
    if (!parse.success)
        return res.status(400).json({ ok: false, error: (0, i18n_1.t)('error.invalidInput', lang), details: parse.error.issues });
    const { name, code } = parse.data;
    const id = require('crypto').randomUUID();
    try {
        const p = (0, pg_1.getPool)();
        const dup = await p.query(`SELECT id FROM warehouses WHERE code = $1`, [code]);
        if ((dup.rowCount || 0) > 0)
            return res.status(409).json({ ok: false, error: (0, i18n_1.t)('warehouses.duplicateCode', lang) });
        await p.query(`INSERT INTO warehouses (id, name, code) VALUES ($1, $2, $3)`, [id, name, code]);
        return res.status(201).json({ id, message: (0, i18n_1.t)('warehouses.created', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * PATCH /:id - Update a warehouse.
 */
exports.warehousesRouter.patch('/:id', async (req, res) => {
    const lang = req.lang || 'en';
    const { id } = req.params;
    const parse = warehouseUpdateSchema.safeParse(req.body);
    if (!parse.success)
        return res.status(400).json({ ok: false, error: (0, i18n_1.t)('error.invalidInput', lang), details: parse.error.issues });
    const { name, code } = parse.data;
    try {
        const p = (0, pg_1.getPool)();
        const exist = await p.query(`SELECT id FROM warehouses WHERE id = $1`, [id]);
        if (exist.rowCount === 0)
            return res.status(404).json({ ok: false, error: (0, i18n_1.t)('warehouses.notFound', lang) });
        if (code) {
            const dup = await p.query(`SELECT id FROM warehouses WHERE code = $1 AND id <> $2`, [code, id]);
            if ((dup.rowCount || 0) > 0)
                return res.status(409).json({ ok: false, error: (0, i18n_1.t)('warehouses.duplicateCode', lang) });
        }
        const r = await p.query(`UPDATE warehouses SET name = COALESCE($1, name), code = COALESCE($2, code) WHERE id = $3 RETURNING id`, [name ?? null, code ?? null, id]);
        if (r.rowCount === 0)
            return res.status(404).json({ ok: false, error: (0, i18n_1.t)('warehouses.notFound', lang) });
        return res.json({ id, message: (0, i18n_1.t)('warehouses.updated', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * DELETE /:id - Delete a warehouse.
 */
exports.warehousesRouter.delete('/:id', async (req, res) => {
    const lang = req.lang || 'en';
    const { id } = req.params;
    try {
        const p = (0, pg_1.getPool)();
        const r = await p.query(`DELETE FROM warehouses WHERE id = $1`, [id]);
        if ((r.rowCount || 0) === 0)
            return res.status(404).json({ ok: false, error: (0, i18n_1.t)('warehouses.notFound', lang) });
        return res.json({ id, message: (0, i18n_1.t)('warehouses.deleted', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
