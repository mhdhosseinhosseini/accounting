# Prisma Setup Plan (Accounting)

This document outlines how we will introduce Prisma ORM for the accounting backend using PostgreSQL.

## Goals
- Use Prisma to manage schema and migrations for all accounting entities.
- Generate type-safe database client for Node/Express routes.
- Keep migrations auditable and deterministic across environments.

## Prerequisites
- PostgreSQL available locally: `postgres://postgres:postgres@localhost:5432/greenbunch_accounting`
- Accounting backend `.env` file with `DATABASE_URL` set.
- Node.js v18+.

## Packages
Install Prisma and the client in `accounting/back-end`:
- `npm i -D prisma`
- `npm i @prisma/client`

## Initialization Steps
1. Initialize Prisma in backend:
   - `npx prisma init` (creates `prisma/schema.prisma` and `.env` entries)
   - Ensure `DATABASE_URL` in `.env` points to the accounting database.
2. Configure `schema.prisma` generator:
   - `provider = "postgresql"`
   - Add `previewFeatures = ["fullTextSearch"]` only if required later.
3. Add basic model placeholders (empty tables first, refined in Phase 2):
   - `User`, `Customer`, `Account`, `JournalEntry`, `JournalLine`, `Invoice`, `InvoiceLine`, `Payment`, `Tax`, `Currency`, `CompanySettings`.
   - In Phase 2 we will fully define fields, relations, indices.

## Migrations Workflow
- Development:
  - `npx prisma migrate dev --name init` (first migration)
  - Subsequent changes with descriptive names (e.g., `add-invoice-status`).
- Production:
  - Use `npx prisma migrate deploy` on CI/CD to apply committed migrations.

## Seeding
- Create `prisma/seed.ts` and enable seeding in `package.json`:
  - `"prisma": { "seed": "ts-node prisma/seed.ts" }`
- Seed minimal reference data (e.g., default currency, tax rates, chart of accounts template).

## Type Safety and Usage
- Import client via `import { PrismaClient } from '@prisma/client'`.
- Use a singleton Prisma client in backend (attach to app context or module-level).
- Avoid creating clients per request.

## Environment Management
- `.env.example` already provided with `DATABASE_URL`.
- For tests, consider `DATABASE_URL` pointing to a test DB.
- Document migrations expectations in `DEPLOYMENT.md`.

## Performance and Indexing
- Add indices on frequently queried fields (e.g., `JournalEntry.date`, `Invoice.customerId`, `Payment.invoiceId`).
- Use composite indices for reporting needs.

## Observability
- Enable query logging in development (Prisma `log` option).
- Consider soft-deletes and audit tables where appropriate (Phase 3+).

## Next Actions
- Phase 2: design the schema for core accounting (journals, invoices, payments).
- Phase 2: implement seeding for chart of accounts.
- Phase 2: wire queries in route handlers with Prisma-generated types.