# Accounting Front-End Plan

The Accounting front-end will be a React application designed for Farsi-first usage (RTL) while supporting English. It follows the system design docs and integrates with the Accounting backend under `accounting/back-end`.

## Tech Stack
- React + TypeScript
- TailwindCSS (RTL plugin)
- React Router
- React Query (data fetching and caching)
- Component libs: Headless UI or custom components
- Date: Jalali date picker for Persian calendar
- Charts: Recharts for reporting

## Pages (phase 1)
- Login / Logout
- Dashboard (summary cards)
- Accounts (tree view + CRUD)
- Journals (list + create/post)
- Fiscal Years (list, create, close/open)
- Reports (Trial Balance, Ledger, Balance Sheet, Profit & Loss)

## i18n & RTL
- Full RTL layout for Farsi
- Locale switch (fa/en)
- Translations stored in JSON; shared keys with backend where useful
- Fonts: Vazir / IRANSans

## API Base
- `VITE_API_BASE` → points to `http://localhost:4100/api/v1` in development

## Next Steps
- Scaffold React app with Vite
- Add i18n (fa/en) and RTL baseline
- Implement auth and protected routes
- Build JournalForm with double-entry validation (client-side)

## Contributor Note: TypeScript-only Sources in `src`

- Author all source files in `src` as `.ts`/`.tsx`. Avoid `.js` duplicates next to TS files; they can shadow TypeScript in dev and break HMR.
- TypeScript is configured with `noEmit: true` in `tsconfig.json`. The build script runs `tsc --noEmit && vite build`, so JS artifacts are never written into `src`.
- If you ever see `.js` siblings in `src`, delete them. Vite resolves TS first and HMR stays reliable.
- Development: run `npm run dev` for instant updates (HMR). Preview build: run `npm run build` then `npm run preview`.
- i18n: when adding or changing UI text, update translations in `src/i18n/locales/fa.json` and `src/i18n/locales/en.json` to keep Farsi and English in sync.