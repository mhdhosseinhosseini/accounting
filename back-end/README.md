# Accounting Back-end (Express API)

English: Back-end service for the Accounting module. Provides REST APIs for auth and core resources.
فارسی: سرویس پشتیبان حسابداری که APIهای REST برای احراز هویت و منابع اصلی فراهم می‌کند.

## Setup
- Node.js LTS (v18 or v20)
- Install dependencies: `npm install`
- Configure environment: copy `.env.example` to `.env` and update values

## Scripts
- `npm run dev` — start in development (nodemon + ts-node)
- `npm run build` — compile TypeScript to `dist`
- `npm run start` — run compiled server
- `npm run typecheck` — TypeScript type checking only
- `npm run lint` — ESLint checks
- `npm run format` — Prettier formatting

## Environment Variables
See `.env.example` for all variables (with English/Farsi comments).

## Security Baselines
English: The following security measures are applied or planned for Phase 1.
فارسی: اقدامات امنیتی زیر در فاز یک اعمال یا برنامه‌ریزی شده‌اند.

- HTTP security headers via `helmet` (already added in dependencies)
  - CSP will be configured in Phase 1 according to front-end asset hostnames.
- Rate limiting for OTP endpoints (configurable via `RATE_LIMIT_REQUEST_OTP_PER_MIN`)
- Input validation using `zod` for request payloads
- CORS configured to allow front-end origin during development and production
- Accept-Language honored for user-facing messages; default `fa`

## OpenAPI
Minimal stub in `openapi.yaml` for auth/OTP endpoints. Expand in later phases.

## Migrations
English: Run database migrations before starting in staging/production. A `schema_migrations` table tracks applied versions.
فارسی: پیش از اجرا در استیجینگ/تولید، مهاجرت پایگاه‌داده را اجرا کنید. جدول `schema_migrations` نسخه‌های اعمال‌شده را نگه می‌دارد.

- Postgres:
  - `DB_DRIVER=postgres POSTGRES_URL=postgres://user:pass@host:5432/db npm run migrate:pg`
  - Then seed minimal data: `npm run seed`
  - فارسی: پس از مهاجرت، برای مقداردهی اولیه: `npm run seed`

- SQLite (development):
  - `DB_DRIVER=sqlite SQLITE_FILE=./dev.sqlite npm run migrate:sqlite`
  - Then seed minimal data: `npm run seed`
  - فارسی: پس از مهاجرت، برای مقداردهی اولیه: `npm run seed`

## Notes
- Farsi-first: prefer `fa` defaults and RTL considerations in client-side UIs.
- Secrets: never commit real secrets; inject via environment during deploy.