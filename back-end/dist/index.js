"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Accounting backend entrypoint.
 * Sets up Express server, middleware, and initial API routes per design docs.
 */
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const dotenv_1 = __importDefault(require("dotenv"));
const lang_1 = require("./middleware/lang");
const i18n_1 = require("./i18n");
const auth_1 = require("./routes/auth");
// Load environment variables
dotenv_1.default.config();
/**
 * Create and configure the Express application.
 */
function createApp() {
    const app = (0, express_1.default)();
    // Security and common middlewares
    app.use((0, helmet_1.default)());
    app.use((0, cors_1.default)());
    app.use(express_1.default.json());
    app.use((0, morgan_1.default)('dev'));
    app.use(lang_1.langMiddleware);
    /**
     * Auth routes for OTP login (mounted under /api/auth).
     */
    app.use('/api/auth', auth_1.authRouter);
    /**
     * Health check endpoint.
     * Returns localized message indicating service health.
     */
    app.get('/api/health', (req, res) => {
        const lang = req.lang || 'en';
        res.json({ ok: true, message: (0, i18n_1.t)('health.ok', lang) });
    });
    /**
     * List fiscal years (stub).
     * In phase 2 this will query PostgreSQL; now returns empty list.
     */
    app.get('/api/v1/fiscal-years', (req, res) => {
        const lang = req.lang || 'en';
        res.json({ items: [], message: (0, i18n_1.t)('fiscalYears.list', lang) });
    });
    /**
     * Create a journal (draft).
     * Validates double-entry at the request level and returns a stub ID.
     */
    app.post('/api/v1/journals', (req, res) => {
        const lang = req.lang || 'en';
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        const totals = items.reduce((acc, it) => {
            const d = Number(it?.debit || 0);
            const c = Number(it?.credit || 0);
            return { debit: acc.debit + d, credit: acc.credit + c };
        }, { debit: 0, credit: 0 });
        if (Math.abs(totals.debit - totals.credit) > 0.0001) {
            return res.status(400).json({ ok: false, error: (0, i18n_1.t)('error.unbalanced', lang) });
        }
        const id = require('crypto').randomUUID();
        res.status(201).json({ id, status: 'draft', message: (0, i18n_1.t)('journal.created', lang) });
    });
    /**
     * Post a journal (stub).
     * Marks the journal as posted (no persistence yet).
     */
    app.post('/api/v1/journals/:id/post', (req, res) => {
        const lang = req.lang || 'en';
        const { id } = req.params;
        res.json({ id, status: 'posted', message: (0, i18n_1.t)('journal.posted', lang) });
    });
    return app;
}
/**
 * Boot the HTTP server using PORT from environment or default 4100.
 */
function startServer() {
    const app = createApp();
    const port = Number(process.env.PORT || 4100);
    app.listen(port, () => {
        console.log(`Accounting API listening on http://localhost:${port}`);
    });
}
// Start the server when executed directly
startServer();
