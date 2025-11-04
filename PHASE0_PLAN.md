# Accounting Program — Phase 0 Plan (Foundations & Environment)

Scope: Establish project foundations without code changes. Decisions and checklists here guide subsequent implementation phases and ensure consistent Farsi (fa) localization across back-end and front-end.

## 1) Decisions
- Database & ORM: PostgreSQL + Prisma
  - Rationale: fast iteration, typed client, reliable migrations, good ecosystem.
- Auth tokens: JWT Access + Refresh tokens
  - Access ~15 minutes; Refresh ~7–30 days with revocation list in DB.
  - Delivery: HttpOnly cookie preferred; fallback to `Authorization: Bearer` when needed.
- SMS provider: Magfa (production), development fallback via logs and `debugCode`.
- Language: Farsi-first with English support; RTL UI and Jalali date in front-end.

## 2) Environment Variables (per module)

### Back-end (accounting/back-end)
- `PORT` — default `4100`.
- `NODE_ENV` — `development` | `production`.
- `DATABASE_URL` — PostgreSQL connection string.
- `JWT_SECRET` — strong secret; required in prod.
- `JWT_EXPIRES_IN` — e.g., `15m`.
- `REFRESH_TOKEN_EXPIRES_IN` — e.g., `7d`.
- `MAGFA_SMS_BASE_URL` — default `https://sms.magfa.com/api/http/sms/v2/send`.
- `MAGFA_USERNAME` — Magfa username.
- `MAGFA_PASSWORD` — Magfa password.
- `MAGFA_DOMAIN` — sender domain registered at Magfa.
- (Optional) `RATE_LIMIT_REQUEST_OTP_PER_MIN` — e.g., `5`.

### Front-end (accounting/front-end)
- `VITE_API_BASE_URL` — default `http://localhost:4100/api`.
- `VITE_DEFAULT_LANG` — `fa` recommended.
- `VITE_DEV_AUTO_LOGIN` — present; `true` in dev for easier testing.

Checklist:
- Create `.env.example` for both modules with the above keys.
- For production: never commit real secrets; use environment injection during deploy.

## 3) Repo Structure & Module Boundaries
- `accounting/back-end` — Express API, business logic, DB access.
- `accounting/front-end` — React app, RTL layout, Jalali date, client i18n.
- Shared types (future): consider `accounting/shared/` or generated types from OpenAPI.
- Avoid cross-module imports; communicate through HTTP API and shared specs/types only.
- Inter-service boundaries: manufacturing server on `http://localhost:4000`, accounting on `http://localhost:4100`. Future integration will consume manufacturing APIs with explicit contracts, CORS rules, and service-level auth (e.g., service tokens).

## 4) Coding Standards & Tooling Alignment
- TypeScript: enable strict mode across modules; consistent `tsconfig`.
- Linting & Formatting: ESLint + Prettier standard configs; enforce on CI.
- Node version: use LTS (v18 or v20) consistently in dev and CI.
- Commit conventions: conventional commits (optional) for clear history.

## 5) i18n Plan (Farsi/English)
- Back-end:
  - Respect `Accept-Language` header; default to `fa`.
  - Centralize message catalogs and keys (fa/en) for all user-facing responses.
  - Ensure validation and error messages have Farsi equivalents.
- Front-end:
  - Use `react-i18next` (or similar) with Farsi as default; English fallback.
  - RTL layout everywhere; Jalali date picker for forms and filters.
  - Centralized translation files; avoid inline literals in components.

## 6) Security Baselines
- CSP and security headers enabled.
- Input validation and SQL injection protection via query parameterization.
- Rate limiting for OTP endpoints and login flows.
- RBAC groundwork noted for later phases (roles, permissions).

## 7) OpenAPI & Documentation
- Start OpenAPI spec for auth and core resources; expand in later phases.
- Maintain developer docs: setup, run, test, deploy, troubleshooting.
- Add operator docs for fiscal-year operations and reports.

## 8) Immediate Next Actions (No Code)
1. Create `.env.example` in `accounting/back-end` and `accounting/front-end` with variables listed above.
2. Prepare Prisma initialization plan:
   - Add Prisma to back-end; generate schema from Phase 2 tables.
   - Configure `DATABASE_URL` and migration workflow.
3. Draft i18n catalogs structure (fa/en keys) for back-end responses and front-end UI.
4. Align `tsconfig` strictness and list ESLint/Prettier configs to be added in Phase 0.1.
5. Define CI baseline steps: install, lint, typecheck, test, build.

Notes:
- Farsi translations are mandatory for all new user-facing labels and messages.
- We will avoid code changes in Phase 0 planning; implementation begins in Phase 1 with auth and Prisma setup.