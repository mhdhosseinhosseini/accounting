"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.productsRouter = void 0;
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const i18n_1 = require("../i18n");
const auth_1 = require("../middleware/auth");
const pg_1 = require("../db/pg");
/**
 * Router for products CRUD.
 * Postgres-only implementation.
 */
exports.productsRouter = express_1.default.Router();
// All routes require authentication
exports.productsRouter.use(auth_1.requireAuth);
/** Zod schema for product creation. */
const productCreateSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    sku: zod_1.z.string().optional(),
    price: zod_1.z.number().min(0),
});
/** Zod schema for product update. */
const productUpdateSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).optional(),
    sku: zod_1.z.string().optional(),
    price: zod_1.z.number().min(0).optional(),
});
/**
 * GET / - List products.
 */
exports.productsRouter.get('/', async (req, res) => {
    const lang = req.lang || 'en';
    try {
        // Postgres-only list implementation
        const p = (0, pg_1.getPool)();
        const r = await p.query(`SELECT id, name, sku, price FROM products ORDER BY name`);
        return res.json({ items: r.rows, message: (0, i18n_1.t)('products.list', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * POST / - Create a product.
 */
exports.productsRouter.post('/', async (req, res) => {
    const lang = req.lang || 'en';
    const parse = productCreateSchema.safeParse(req.body);
    if (!parse.success)
        return res.status(400).json({ ok: false, error: (0, i18n_1.t)('error.invalidInput', lang), details: parse.error.issues });
    const { name, sku, price } = parse.data;
    const id = require('crypto').randomUUID();
    try {
        // Postgres-only create implementation
        const p = (0, pg_1.getPool)();
        if (sku) {
            const dup = await p.query(`SELECT id FROM products WHERE sku = $1`, [sku]);
            if ((dup.rowCount || 0) > 0)
                return res.status(409).json({ ok: false, error: (0, i18n_1.t)('products.duplicateSku', lang) });
        }
        await p.query(`INSERT INTO products (id, name, sku, price) VALUES ($1, $2, $3, $4)`, [id, name, sku ?? null, price]);
        return res.status(201).json({ id, message: (0, i18n_1.t)('products.created', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * PATCH /:id - Update a product.
 */
exports.productsRouter.patch('/:id', async (req, res) => {
    const lang = req.lang || 'en';
    const { id } = req.params;
    const parse = productUpdateSchema.safeParse(req.body);
    if (!parse.success)
        return res.status(400).json({ ok: false, error: (0, i18n_1.t)('error.invalidInput', lang), details: parse.error.issues });
    const { name, sku, price } = parse.data;
    try {
        // Postgres-only update implementation
        const p = (0, pg_1.getPool)();
        const exist = await p.query(`SELECT id FROM products WHERE id = $1`, [id]);
        if (exist.rowCount === 0)
            return res.status(404).json({ ok: false, error: (0, i18n_1.t)('products.notFound', lang) });
        if (sku) {
            const dup = await p.query(`SELECT id FROM products WHERE sku = $1 AND id <> $2`, [sku, id]);
            if ((dup.rowCount || 0) > 0)
                return res.status(409).json({ ok: false, error: (0, i18n_1.t)('products.duplicateSku', lang) });
        }
        const r = await p.query(`UPDATE products SET name = COALESCE($1, name), sku = COALESCE($2, sku), price = COALESCE($3, price) WHERE id = $4 RETURNING id`, [name ?? null, sku ?? null, price ?? null, id]);
        if (r.rowCount === 0)
            return res.status(404).json({ ok: false, error: (0, i18n_1.t)('products.notFound', lang) });
        return res.json({ id, message: (0, i18n_1.t)('products.updated', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
/**
 * DELETE /:id - Delete a product.
 */
exports.productsRouter.delete('/:id', async (req, res) => {
    const lang = req.lang || 'en';
    const { id } = req.params;
    try {
        // Postgres-only delete implementation
        const p = (0, pg_1.getPool)();
        const r = await p.query(`DELETE FROM products WHERE id = $1`, [id]);
        if ((r.rowCount || 0) === 0)
            return res.status(404).json({ ok: false, error: (0, i18n_1.t)('products.notFound', lang) });
        return res.json({ id, message: (0, i18n_1.t)('products.deleted', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
