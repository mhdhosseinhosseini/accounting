"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
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
const fiscalYears_1 = require("./routes/fiscalYears");
// import { accountsRouter } from './routes/accounts';
const journals_1 = require("./routes/journals");
const products_1 = require("./routes/products");
// import { partiesRouter } from './routes/parties';
const warehouses_1 = require("./routes/warehouses");
const invoices_1 = require("./routes/invoices");
const inventory_1 = require("./routes/inventory");
const auth_2 = require("./middleware/auth");
const driver_1 = require("./db/driver");
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const yaml_1 = __importDefault(require("yaml"));
const reports_1 = require("./routes/reports");
const details_1 = require("./routes/details");
const codes_1 = __importDefault(require("./routes/codes"));
const detailLevels_1 = require("./routes/detailLevels");
const treasury_1 = require("./routes/treasury");
const settings_1 = __importDefault(require("./routes/settings"));
// Load environment variables
dotenv_1.default.config();
// Also load overrides from .env.local if present
dotenv_1.default.config({ path: '.env.local' });
// Parsed OpenAPI spec cache for debugging Swagger UI
let openapiSpec = null;
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
     * Current user endpoint using JWT access token.
     */
    app.get('/api/me', auth_2.requireAuth, (req, res) => {
        const lang = req.lang || 'en';
        const user = req.user || null;
        res.json({ ok: true, user });
    });
    /**
     * Health check endpoint.
     * Returns localized message and database connectivity status.
     */
    app.get('/api/health', async (req, res) => {
        const lang = req.lang || 'en';
        const ping = await (0, driver_1.pingDb)().catch(() => ({ ok: false, driver: 'postgres' }));
        res.json({ ok: true, message: (0, i18n_1.t)('health.ok', lang), db: ping });
    });
    /**
     * Swagger UI: serves OpenAPI spec from openapi.yaml at /api/docs.
     * Attempts multiple paths to locate the YAML file both in dev (src) and build (dist).
     * Persian (Farsi) labels in the spec are preserved via the YAML content.
     */
    try {
        const candidates = [
            path_1.default.resolve(__dirname, '../openapi.yaml'),
            path_1.default.resolve(__dirname, '../../openapi.yaml'),
            path_1.default.resolve(process.cwd(), 'openapi.yaml'),
        ];
        let spec = null;
        for (const p of candidates) {
            if (fs_1.default.existsSync(p)) {
                const file = fs_1.default.readFileSync(p, 'utf8');
                spec = yaml_1.default.parse(file);
                openapiSpec = spec;
                break;
            }
        }
        if (spec) {
            app.use('/api/docs', swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(spec, { explorer: true }));
        }
    }
    catch (e) {
        console.error('Failed to mount Swagger UI:', e);
    }
    /**
     * Expose the parsed OpenAPI spec as JSON for debugging.
     * Route: GET /api/openapi.json
     * Returns the currently loaded OpenAPI document so we can verify 'paths' entries.
     */
    app.get('/api/openapi.json', (req, res) => {
        res.json(openapiSpec || {});
    });
    /**
     * Phase 2 routers: fiscal years, accounts, journals, products, and parties
     */
    app.use('/api/v1/fiscal-years', fiscalYears_1.fiscalYearsRouter);
    // app.use('/api/v1/accounts', accountsRouter); // accounts removed
    app.use('/api/v1/journals', journals_1.journalsRouter);
    app.use('/api/v1/products', products_1.productsRouter);
    // app.use('/api/v1/parties', partiesRouter);
    app.use('/api/v1/warehouses', warehouses_1.warehousesRouter);
    app.use('/api/v1/invoices', invoices_1.invoicesRouter);
    app.use('/api/v1/inventory', inventory_1.inventoryRouter);
    app.use('/api/v1/reports', reports_1.reportsRouter);
    app.use('/api/v1/details', details_1.detailsRouter);
    app.use('/api/v1/codes', codes_1.default);
    app.use('/api/v1/detail-levels', detailLevels_1.detailLevelsRouter);
    app.use('/api/v1/treasury', treasury_1.treasuryRouter);
    app.use('/api/v1/settings', settings_1.default);
    // Journals endpoints are handled by journalsRouter mounted above.
    return app;
}
/**
 * Boot the HTTP server using PORT from environment or default 4000.
 * Ensures database schema before listening to requests.
 */
function startServer() {
    const app = createApp();
    const port = Number(process.env.PORT || 4100);
    (0, driver_1.ensureSchema)()
        .catch((e) => {
        console.error('Failed to ensure schema:', e);
    })
        .finally(() => {
        app.listen(port, () => {
            console.log(`Accounting API listening on http://localhost:${port}`);
        });
    });
}
// Start the server unless running in test mode
if (process.env.NODE_ENV !== 'test') {
    startServer();
}
