# Code Quality Plan (Accounting)

This document outlines TypeScript, ESLint, and Prettier standards for the accounting backend and frontend.

## TypeScript
- Target: Node v18+ for backend, modern browsers for frontend.
- Strict mode enabled (`"strict": true`).
- Recommended compiler options:
  - `"noImplicitAny": true`, `"noImplicitOverride": true`, `"noUncheckedIndexedAccess": true`
  - `"forceConsistentCasingInFileNames": true`, `"skipLibCheck": true`
  - Backend: `"module": "commonjs" or "es2022"` matching current setup; `"outDir": "dist"`.
  - Frontend (Vite): `"module": "esnext"`, `"moduleResolution": "bundler"`.

## ESLint
- Use `@typescript-eslint` plugin and parser.
- Base config: `eslint:recommended` + TypeScript rules.
- Key rules:
  - `no-unused-vars`, `no-constant-condition`, `no-console` (warn in backend, allow in dev)
  - `@typescript-eslint/explicit-module-boundary-types` (warn)
  - `@typescript-eslint/no-misused-promises`, `@typescript-eslint/no-floating-promises`
- Separate configs for backend and frontend to reflect environment differences.

## Prettier
- Enforce formatting via Prettier with a shared config:
  - Print width 100, semi-colons on, single quotes, trailing commas where valid.
- Integrate with ESLint using `eslint-config-prettier` to avoid conflicts.

## Scripts (package.json)
- Backend:
  - `lint`: `eslint "src/**/*.{ts,js}"`
  - `format`: `prettier --write "src/**/*.{ts,js}"`
  - `typecheck`: `tsc --noEmit`
- Frontend:
  - `lint`: `eslint "src/**/*.{ts,tsx}"`
  - `format`: `prettier --write "src/**/*.{ts,tsx,css}"`
  - `typecheck`: `tsc --noEmit`

## Editor and CI
- Include `.editorconfig` for basic consistency.
- CI should run `typecheck`, `lint`, and `format:check` (Prettier) in PRs.

## Farsi Localization Notes
- Ensure i18n keys are used consistently and avoid hardcoded strings.
- Validate that RTL styles are applied where needed on the frontend.

## Next Actions
- Phase 1: add configs and scripts (no code logic changes).
- Phase 1: enforce checks in CI baseline.