# Accounting Program — Project Plan Tasks

This file defines the concrete steps to build the Accounting program aligned with:
- `/accounting/طرح_جامع_نرم_افزار_حسابداری_وبی.md`
- `/accounting/اسناد_اجرایی_نرم_افزار_حسابداری.md`

All tasks consider Persian (fa) localization for user-facing labels and messages.

## Phase 0 — Foundations & Environment
- Confirm repo structure and module boundaries (front-end, back-end, shared types).
- Establish environment files across modules (`.env`, `.env.local`) and document required variables.
- Decide DB provider and tooling (PostgreSQL + Prisma or TypeORM), prefer Prisma for speed.
- Set coding standards and formatting; enable lint/tsconfig alignment across modules.
- Add base i18n scaffolding for Farsi and English in both back-end and front-end.

## Phase 1 — Authentication & Session Model
- Define auth model: OTP login bridged to JWT access/refresh tokens.
- Design `/api/auth/login` (OTP verify → issue JWT), `/api/auth/refresh`, `/api/auth/logout`, `/api/me`.
- Implement rate limiting and basic abuse protection for OTP endpoints.
- Persist refresh tokens securely (DB table) with revocation.
- Document auth flow and token lifetimes; update OpenAPI.

## Phase 2 — Database Modeling & Migrations
- Create Prisma/TypeORM schema for core tables from docs:
  - `users`, `roles`, `user_roles`
  - `fiscal_years`, `accounts`, `journals`, `journal_items`
  - `parties`, `products`, `warehouses`
  - `invoices`, `invoice_items`
  - `inventory_transactions`, `payments`
  - `opening_entries`, `closing_entries`, `audit_logs`
- Generate initial migrations; set up seed scripts for minimal working data.
- Add DB connection management and health checks.

## Phase 3 — Core Accounting Flows
- Implement Journals API: create, list, post, reverse (transactional integrity).
- Implement Fiscal Years API: list, create, close, open-next (per docs’ algorithms).
- Implement Accounts API: tree fetch, CRUD, validations (code uniqueness, hierarchy levels).
- Implement Parties, Products, Warehouses basic CRUD to support invoices.

## Phase 4 — Invoicing & Inventory Integration
- Implement Invoices API: CRUD, posting workflow (generate related journal items).
- Implement Inventory transactions and linkage to invoice posting (optional auto-post).
- Ensure double-entry consistency; add validations for totals.

## Phase 5 — Reports
- Implement endpoints:
  - Trial Balance (`/reports/trial-balance`)
  - Ledger (`/reports/ledger`)
  - Balance Sheet (`/reports/balance-sheet`)
  - Profit & Loss (`/reports/profit-loss`)
- Optimize with indexes; consider materialized views for heavy queries (future).

## Phase 6 — Front-end (Accounting)
- Build login/verification with OTP → JWT storage (HttpOnly cookie or local storage per security policy).
- Implement RTL layout, Farsi-first UI, Jalali date picker.
- Pages: Dashboard, Accounts Tree, Journals (list/form/post), Invoices, Parties, Warehouses, Reports, Fiscal Years.
- Integrate client-side i18n (fa/en) for all visible labels; centralize messages.

## Phase 7 — Security & Compliance
- Enable CSP, security headers, input validation, SQL injection protection.
- Add rate limiting, brute-force protection for auth.
- Role-based access control (RBAC) checks on sensitive endpoints.
- Audit logging for critical changes.

## Phase 8 — Testing & Quality
- Unit tests for accounting logic (posting, balances, closing/opening).
- Integration tests for core endpoints (auth, journals, invoices).
- E2E tests (Cypress/Playwright) for primary flows (login, create/post journal, report view).
- Add seed data and fixtures for consistent test runs.

## Phase 9 — DevOps & Deployment
- Dockerize back-end and front-end plus PostgreSQL (compose setup).
- CI pipeline: lint, test, build; deploy to staging; manual approval to production.
- Environment management and secrets (Magfa SMS, DB URL, JWT secrets).
- Basic monitoring and centralized logs.

## Phase 10 — Documentation & Onboarding
- OpenAPI spec coverage for all public endpoints.
- Developer docs: setup, run, test, deploy, troubleshooting.
- Admin/operator docs: fiscal-year operations, reports, data corrections policy.

## Phase 11 — Enhancements & Performance (Post-MVP)
- Caching for hot endpoints; query tuning.
- Report exports (CSV/PDF) and background jobs for heavy tasks.
- Permissions fine-tuning; audit trail viewers.

---

### Milestones & Acceptance Criteria
- M1: Auth + DB ready; OTP→JWT working; OpenAPI auth documented.
- M2: Journals + Accounts + Fiscal Years implemented; close/open-next passes tests.
- M3: Invoices + Inventory posting; core reports available with correct balances.
- M4: Front-end pages functional (RTL + Farsi); E2E happy path green.
- M5: CI/CD, Docker deployment, staging live.

### Localization Note (Farsi)
- Every new endpoint or UI element must include Farsi strings.
- Back-end responses support `Accept-Language`; front-end uses i18n catalogs.

### Implementation Order (Suggested)
1) Phase 0 → Phase 1 → Phase 2
2) Phase 3 (journals/fiscal years/accounts)
3) Phase 4 (invoices/inventory)
4) Phase 5 (reports)
5) Phase 6 (frontend) parallel after APIs stabilize
6) Phases 7–10 for production readiness

### Dependencies
- Magfa SMS credentials for production OTP delivery.
- PostgreSQL instance + network access.
- JWT secret management.

### Risks & Mitigations
- Complex report correctness → invest in unit/integration tests.
- Fiscal-year transitions → transactionally safe routines with rollbacks.
- i18n consistency → central catalogs and review process.