# Accounts Coding Design (Proposal)

Status: Proposal only — no code changes applied yet.
Scope: Accounts page at `http://localhost:5176/accounts` and related data.

## Goals
- Model a two-level codes tree (General → Specific) and a global Detail catalogue (4-digit, no prefix) that can be linked to multiple Specifics.
- Make Accounts select a Specific and optionally a Detail; no subaccounts.
- Keep UI simple while supporting legacy/non-conforming charts via permissive validation.
- Use existing project theme components for buttons and inputs.
- Ensure Farsi localization readiness for all labels/messages.
- Standardize numeric input UX across pages using a shared NumericInput.

## Hierarchy Model
- Two-Level Tree + Global Details
  - Tree contains only `general` and `specific` nodes (adjacency list).
  - `detail` codes are global records and are not part of the tree; a `detail` can be assigned to multiple `specific` accounts (many-to-many).
  - Depth of the tree: 2 levels (General → Specific). No nested Details in the tree.
  - Rationale: preserves flexibility for organizations with existing charts and supports shared Details across different Specifics.

## Accounts and Hierarchy
- Accounts link to a `specific` and optionally to a global `detail` (4-digit, no prefix).
- There are no subaccounts or nested accounts in this design.
- An Account’s `type` is derived from the ancestor `general` of the selected `specific` (not from `detail`).
- UI: use a single page with a tree to manage `general` and `specific`; the Accounts form uses a tree picker for `specific` and a separate selector for `detail` filtered to allowed links.

## Code Policy and Compatibility
- Digits-only (`^[0-9]+$`), no decimals or negatives; allow leading zeros.
- Validation mode (configurable):
  - `strict`: enforce recommended widths and relationships.
  - `permissive`: accept legacy/non-conforming codes while keeping uniqueness.
- Recommended widths (for new data):
  - `general.code`: 2 digits (supports 1-digit if needed).
  - `specific.code`: 4 digits; may start with its `general` prefix when `strict`.
  - `detail.code`: exactly 4 digits; no prefix; global namespace.
- Optional `fullCode` for display: `GENERAL-SPECIFIC` (Detail shown separately).
- Constraints:
  - `general.code` unique among `general`.
  - `specific.code` unique within its parent `general`.
  - `detail.code` unique globally (independent of `specific`).
  - `Account.code` unique globally (if used).

## Data Model (Conceptual)
- CodeNode (Generals and Specifics only): `{ id, parentId?, code, name, kind: 'general'|'specific', description?, pathSlug?, fullCode?, sortOrder?, depth?, isActive }`
  - `parentId` null only for `general`.
  - `kind` rules: `specific` parent must be `general`.
  - `pathSlug` mirrors CategoryManager’s slug logic for readable paths; `fullCode` caches `general`+`specific` for fast lookup.
  - `sortOrder` supports sibling reordering; `depth` can be maintained for optimization.
- Detail (global catalogue): `{ id, code, name, isActive }`
  - `code` is exactly 4 digits; unique globally; no prefix or parent.
- SpecificDetailLink (many-to-many): `{ specificId, detailId }` to control which details are allowed under which specifics.
- Account: `{ id, code, name, type, specificId, detailId?, isActive, openingBalance?, currency?, notes?, fullPathName? }`
  - `type` ∈ { `asset`, `liability`, `equity`, `revenue`, `expense` } derived from the ancestor `general` of the chosen `specific`.

## Excel Alignment (سپیدار)
- Excel defines `general` and `specific` codes; `detail` codes exist as a global catalogue and may be associated with different `specific` accounts.
- Import plan:
  - Create `general` nodes per Excel.
  - Create `specific` nodes under each General.
  - Create `detail` records (global) with 4-digit codes.
  - Build `SpecificDetailLink` rows to associate details to the relevant specifics (as per Excel or business rules).
  - Provide bulk import with dry-run validation to surface code width, uniqueness, and missing link issues.

## Backend API (Proposed)
- Codes Tree (Generals & Specifics):
  - `GET /api/v1/codes/tree` → full tree; supports `depth`, `rootId`, `includeInactive`.
  - `GET /api/v1/codes/children` → children for `parentId`; filters: `kind ∈ {general,specific}`, `isActive`, `limit`, `offset`.
  - `GET /api/v1/codes` → flat list with filters: `q`, `kind ∈ {general,specific}`, `parentId`, `isActive`.
  - `GET /api/v1/codes/:id/path` → ancestors path with `kind`, `code`, `name`; returns derived `type` for `specific` via its `general`.
  - `POST /api/v1/codes/validate` → pre-validate `{ code, kind: 'general'|'specific', parentId }` for digits-only, width policy, uniqueness.
  - `POST /api/v1/codes` → create node `{ code, name, kind, parentId?, sortOrder? }` with parent-kind validation.
  - `PUT /api/v1/codes/:id` → update node.
  - `PATCH /api/v1/codes/:id/move` → move node to a new `parentId` with cycle and kind validation; revalidate uniqueness in new scope.
  - `PATCH /api/v1/codes/:id/reorder` → update `sortOrder` within siblings.
  - `PATCH /api/v1/codes/:id/activate` → toggle `isActive` (block linking under inactive parents).
  - `DELETE /api/v1/codes/:id` → delete (soft recommended if descendants exist; hard-delete only when no descendants and not linked).
  - `POST /api/v1/codes/import` → bulk import (Excel); supports `dryRun=true` to return validation report.
- Details (Global Catalogue):
  - `GET /api/v1/details` → list; filters: `q`, `isActive`.
  - `GET /api/v1/details/:id` → detail record.
  - `POST /api/v1/details/validate` → pre-validate `{ code }` for 4-digit width and uniqueness.
  - `POST /api/v1/details` → create detail `{ code, name, isActive }` (4-digit code, no prefix).
  - `PUT /api/v1/details/:id` → update detail.
  - `PATCH /api/v1/details/:id/activate` → toggle `isActive`.
  - `POST /api/v1/details/suggest-next` → returns next available 4-digit code.
- Detail Links to Specifics:
  - `POST /api/v1/specifics/:specificId/details/:detailId` → link.
  - `DELETE /api/v1/specifics/:specificId/details/:detailId` → unlink.
  - `GET /api/v1/specifics/:specificId/details` → list linked details.
- Accounts
  - `GET /api/v1/accounts` → list; filters: `q`, `type`, `specificId`, `detailId`, `isActive`.
  - `GET /api/v1/accounts/:id/path` → returns account’s specific path and derived `type` (general of the specific), plus the linked detail if any.
  - `POST /api/v1/accounts` → create account (requires `specificId`, optional `detailId`). Ancestor `general` of `specificId` determines `type`.
  - `PUT /api/v1/accounts/:id` → update account.
  - `DELETE /api/v1/accounts/:id` → soft delete or deactivate.

Notes:
- Adapters can map existing endpoints to this shape while migrating incrementally.

## Front-End UI/UX (Codes Manager + Details)
- Codes Manager (CategoryManager-style) for Generals & Specifics:
  - Tree view with expand/collapse, create/edit/delete, move (change parent), reorder siblings.
  - Node form: `code`, `name`, `kind ∈ {general,specific}`, `parent` (only for `specific`), `active`.
  - Validation messages on parent-kind mismatch, duplicate codes, and digits-only/length policy violations.
- Details Manager (Global):
  - Grid/list to manage 4-digit `detail` codes; link/unlink to `specific` accounts.
  - “Suggest next code” action to fill the next available 4-digit code.
- Accounts Page
  - Tree picker for selecting a `specific`.
  - Detail selector (dropdown or searchable) showing linked details to the selected specific; optionally allow global selection when links are not enforced.
  - Numeric Input Standard for codes: digits-only, no decimals/negatives; `NumericInput` configured to 4 digits for detail codes without any prefix.

## Theming and Components
- Reuse existing theme components and RTL support.
- Follow CategoryManager interaction patterns (slugging, uniqueness checks) adapted to accounting codes.
- Shared `NumericInput` component for code fields and numeric amounts:
  - In Farsi, displays Persian digits on blur; caret-safe typing; optional stepper off for code.
  - For numeric amounts (journals), keep stepper on and decimal scale per currency policy.

## Localization (Farsi)
- Keys (examples):
  - `codes.title`: "کدینگ حسابداری"
  - `codes.addNode`: "افزودن گره"
  - `codes.editNode`: "ویرایش گره"
  - `codes.deleteNode`: "حذف گره"
  - `codes.moveNode`: "جابجایی گره"
  - `codes.reorder`: "مرتب‌سازی"
  - `codes.kind`: "نوع گره"
  - `codes.kind.general`: "کد عمومی"
  - `codes.kind.specific`: "کد اختصاصی"
  - `codes.parent`: "والد"
  - `codes.noParent`: "بدون والد"
  - `codes.code`: "کد"
  - `codes.name`: "نام"
  - `codes.active`: "فعال"
  - Validation: `codes.validation.uniqueCode`, `codes.validation.parentKindMismatch`, `codes.validation.selectParent`, `codes.validation.digitsOnly`, `codes.validation.lengthPolicy`, `codes.validation.inactiveParent`.
- Details (global) keys:
  - `details.title`: "تفصیلات"
  - `details.code`: "کد تفصیل"
  - `details.suggestNext`: "پیشنهاد کد تفصیل بعدی"
  - `details.link`: "اتصال به معین"
  - `details.unlink`: "قطع اتصال از معین"
  - Validation: `details.validation.width4`: "کد تفصیل باید ۴ رقمی باشد.", `details.validation.unique`: "کد تفصیل تکراری است.", `details.validation.noPrefix`: "کد تفصیل بدون پیشوند است."
- Accounts (unchanged where applicable), ensure RTL and numerals.

## Validation Rules
- Parent-kind constraints (tree):
  - `general` → parent must be null.
  - `specific` → parent must be `general`.
  - `detail` → not part of the tree.
- Code content:
  - Digits-only; disallow decimals and negatives for all `code` fields.
  - Recommended widths in `strict` mode; allow legacy in `permissive` mode.
  - `detail.code` must be exactly 4 digits; no prefix.
- Uniqueness:
  - `general.code` unique among generals; `specific.code` unique under its general.
  - `detail.code` unique globally (independent of specific links).
  - Revalidate uniqueness on `move` within the new sibling scope (tree only).
- Activation:
  - Cannot create children under inactive parents; cannot link Accounts to inactive `specific` or `detail` records.
- Safety:
  - Prevent cycles on move; warn or block delete when descendants exist (prefer soft-delete with constraint checks).
  - For links, block unlink when Accounts depend on a specific-detail pair unless reassigned.

## Migration and Data Considerations
- Consolidate Generals & Specifics to the `codes` table (adjacency list) from legacy `general_codes` and `specific_codes`.
- Create a `details` table for global 4-digit codes; migrate from legacy `detail_codes`.
- Create `specific_detail_links` table to model many-to-many associations (replaces previous single-parent detail design).
- Add indexes: `parentId`, `kind`, `code` (partial uniqueness per scope for codes), `sortOrder`, `isActive`; for `details`, unique index on `code`.
- Backfill paths for display; store `pathSlug` and `fullCode` (general+specific) for fast lookup; optionally maintain `depth`.
- Bulk import tooling with dry-run: validate digits-only, width policy, uniqueness, and missing/invalid links.
- Accounts link to `specificId` and optional `detailId`; `type` derived from the selected `specific`’s ancestor `general`.

## Implementation Plan (Phased)
1) Introduce `codes` table (Generals & Specifics) and CRUD endpoints; create `details` table and CRUD; add link endpoints (`specific_detail_links`).
2) Implement move and reorder operations on the codes tree with validation.
3) Update Accounts create/edit to select a `specific` from the tree and an optional `detail` from the global catalogue (filtered by links); derive type from the specific’s `general`.
4) UI: adapt CategoryManager to codes tree; add Details manager (grid + link/unlink); adopt shared NumericInput configured to 4 digits for detail codes.
5) Bulk import (Excel) with dry-run; seed Generals/Specifics, create Details (4-digit), and build links.
6) QA: verify end-to-end flows, uniqueness, activation rules, link constraints, and RTL/i18n numerals.

## Rationale — Update Based on CategoryManager Pattern
- A simple two-level tree (Generals & Specifics) fits existing UI patterns and keeps operations straightforward.
- Managing Details as a global catalogue with many-to-many links preserves flexibility for charts that don’t follow strict prefixes and allows shared details across different specifics.

## Open Questions
- Should detail selection be restricted only to linked details, or allow global selection with a warning?
- For legacy/permissive mode, which non-conforming widths are acceptable for general/specific?
- Do we need audit trails for link/unlink operations when accounts already reference a pair?
- Should code inputs force `dir="ltr"` in Farsi for readability, or inherit RTL?

## Acceptance Criteria
- Codes Manager manages Generals and Specifics; Details are managed separately in a global catalogue.
- Accounts can select a Specific and optionally a global Detail; type is derived from the Specific’s General.
- Validation:
  - Digits-only for all codes; strict/permissive modes supported.
  - Detail code is exactly 4 digits with no prefix; uniqueness enforced globally.
  - General and Specific uniqueness enforced per scope; move operations revalidate.
- Backend exposes the codes tree CRUD, details CRUD, link/unlink endpoints, and `details/suggest-next`.
- UI uses the shared `NumericInput`; detail entry enforces 4 digits and shows Persian digits on blur; Specific is chosen from the tree; Details show without any prefix.
- Farsi labels and RTL render correctly across Codes Manager, Details Manager, and Accounts forms.
- Validation errors show localized Farsi messages for digits-only, width policy, uniqueness, parent-kind, and link constraints.