# Accounting System (Separate Service)

This folder houses a standalone Accounting system to be shared across GreenBunch and other domains (e.g., Retail). It follows the designs provided and will evolve into a production-ready service.

## Design References
- Comprehensive design (Farsi): `./طرح_جامع_نرم_افزار_حسابداری_وبی.md`
- Execution docs (Farsi): `./اسناد_اجرایی_نرم_افزار_حسابداری.md`

## Structure
- `front-end/` — React-based UI (RTL, Jalali date), reporting and journal entry screens.
- `back-end/` — Node.js (TypeScript + Express) API implementing Accounts, Journals, Fiscal Years, Invoices, and Reports.

## Tech Stack (per design)
- Frontend: React + TailwindCSS, RTL support, Jalali date picker.
- Backend: Node.js (Express/NestJS), PostgreSQL, JWT auth.
- Optional: Redis for cache/queue; S3/MinIO for file storage.

## Initial APIs (phase 1)
- `GET /api/v1/health` — Service health.
- `GET /api/v1/fiscal-years` — List fiscal years.
- `POST /api/v1/journals` — Create journal (validates double-entry).
- `POST /api/v1/journals/:id/post` — Post journal.

## Localization
- Backend honors `Accept-Language` header (e.g., `fa`, `en`) for messages.
- Frontend will be fully RTL with Farsi translations for all labels.

## Quick Start (backend)
1. `cd accounting/back-end`
2. `npm install`
3. `npm run dev` (starts dev server on port 4100)

## Next Steps
- Scaffold backend with TypeScript + Express and i18n.
- Define DB schema and migrations (PostgreSQL).
- Implement core posting rules and journals.
- Scaffold frontend pages: Accounts, Journals, Reports.