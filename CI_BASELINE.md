# CI Baseline Plan (Accounting)

This document describes the baseline continuous integration checks for the accounting backend and frontend.

## Objectives
- Ensure builds are reproducible and pass type, lint, and format checks.
- Run unit tests when available.
- Apply Prisma migrations safely in deploy stages (not in CI checks).

## Recommended Environment
- Node.js 20.x (LTS) for both backend and frontend.
- Cache `~/.npm` for faster installs.

## Jobs (per repo or monorepo context)
- Backend (accounting/back-end):
  - Steps:
    - `npm ci`
    - `npm run typecheck`
    - `npm run lint`
    - `npm run build`
  - Optional: `npm run test` when tests exist.
- Frontend (accounting/front-end):
  - Steps:
    - `npm ci`
    - `npm run typecheck`
    - `npm run lint`
    - `npm run build`

## Sample GitHub Actions Skeleton
```yaml
name: Accounting CI
on:
  pull_request:
    paths:
      - 'accounting/**'
  push:
    branches: [ main ]

jobs:
  backend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: accounting/back-end
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20.x'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run build

  frontend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: accounting/front-end
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20.x'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run build
```

## Deployment Notes
- Use `prisma migrate deploy` during deployment to apply DB migrations.
- Set environment variables from secrets (`JWT_SECRET`, `DATABASE_URL`, Magfa credentials).

## Next Actions
- Phase 1: add CI configuration to the repository (GitHub Actions or your chosen CI).
- Phase 1: ensure scripts exist in `package.json` for typecheck, lint, and build.