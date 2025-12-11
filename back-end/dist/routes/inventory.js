"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.inventoryRouter = void 0;
const express_1 = __importDefault(require("express"));
const i18n_1 = require("../i18n");
const auth_1 = require("../middleware/auth");
const pg_1 = require("../db/pg");
/**
 * Router for inventory transactions listing.
 * Postgres-only implementation.
 */
exports.inventoryRouter = express_1.default.Router();
// All routes require authentication
exports.inventoryRouter.use(auth_1.requireAuth);
/**
 * GET / - List inventory transactions (Postgres-only).
 */
exports.inventoryRouter.get('/', async (req, res) => {
    const lang = req.lang || 'en';
    try {
        const p = (0, pg_1.getPool)();
        const r = await p.query(`SELECT id, product_id, warehouse_id, quantity, type, date, reference
       FROM inventory_transactions
       ORDER BY date DESC`);
        return res.json({ items: r.rows, message: (0, i18n_1.t)('inventory.transactions.list', lang) });
    }
    catch {
        return res.status(500).json({ ok: false, error: (0, i18n_1.t)('error.generic', lang) });
    }
});
