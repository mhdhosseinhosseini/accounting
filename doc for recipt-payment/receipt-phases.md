# Treasury — Receipts Implementation Phases

This document outlines the phased plan to implement the Treasury "Receipt" tab. It focuses exclusively on Receipts and does not alter Cashbox, Bank Manager, or Check Manager.

## Scope
- Implement a standalone "Receipt" tab within Treasury (list + form views).
- Support multi-action receipts with items of type: Cash, Card (POS), Bank Transfer, Check.
- Keep integration read-only for related entities (cashboxes, bank accounts, card readers, checks).
- Do not modify Cashbox, Bank Manager, or Check Manager features or workflows.

## Phases Overview
- Phase 0: Scope Alignment & Readiness
- Phase 1: API Contract & Data Model Alignment
- Phase 2: Frontend Scaffolding (Routes, Pages, Types)
- Phase 3: Receipts List View (filters, table, actions)
- Phase 4: Receipt Form — Header (date, payer, status, numbering)
- Phase 5: Receipt Form — Items (cash, card, transfer, check rows)
- Phase 6: Validations & Totals (row-level and form-level)
- Phase 7: Posting Flow & Status Guardrails
- Phase 8: Error Handling & I18N (English + Farsi)
- Phase 9: Printing & Attachments (basic, consistent with current system)
- Phase 10: QA, Accessibility, RTL, Performance
- Phase 11: Documentation & Handoff

## Phase Details

### Phase 0: Scope Alignment & Readiness
- Confirm the "Receipt" tab is isolated; no changes to Cashbox, Bank Manager, Check Manager.
- Identify existing endpoints to reuse; define fallback plan (mock service) if backend is not ready.
- Define acceptance criteria for MVP (create, edit, post, error visibility, Farsi parity).

### Phase 1: API Contract & Data Model Alignment
- Finalize endpoints: `GET /receipts`, `GET /receipts/:id`, `POST /receipts`, `PUT /receipts/:id`, `POST /receipts/:id/post`, `DELETE /receipts/:id`.
- Confirm `receipts` + `receipt_items` shape, `instrument_type` enum, and status values (e.g., `draft`, `posted`, `canceled`).
- Map server error codes to UI keys (e.g., foreign key restricts for checks/banks) for clean localization.

### Phase 2: Frontend Scaffolding (Routes, Pages, Types)
- Add routes: `/treasury/receipts`, `/treasury/receipts/new`, `/treasury/receipts/:id`.
- Create core components: `ReceiptListView`, `ReceiptFormView`, `ReceiptHeader`, `ReceiptItemsTable`, `TotalsBar`, `ActionsBar`.
- Add `types/receipts.ts` and `services/receipts.ts` with function-level comments.

### Phase 3: Receipts List View (filters, table, actions)
Status: Completed

- Implemented filters: date range, payer, status, text search.
- Implemented table columns: number, date, payer, total, status, actions.
- Implemented actions: view, edit (draft only), print (posted or draft), delete (draft only).

Implementation Notes:
- Frontend page: `accounting/front-end/src/pages/ReceiptsPage.tsx`.
- Uses client-side filtering until backend query params exist.
- All labels use `t(...)` keys; add Farsi translations for keys:
  - `filters.*`, `fields.*`, `status.*`, `actions.*`, `common.*`, `pages.receipts.*`.

### Phase 4: Receipt Form — Header (date, payer, status, numbering)
- Fields: date, payer, fiscal period (read-only or auto), description, status (read-only), number (auto on post).
- Draft vs posted behavior for editability; guard unsaved changes with a leave-confirm dialog.

### Phase 5: Receipt Form — Items (cash, card, transfer, check rows)
- Dynamic rows with `instrument_type` selector: Cash, Card (POS), Bank Transfer, Check.
- Instrument-specific fields:
  - Cash: cashbox, amount.
  - Card: card reader, bank account, ref code, amount.
  - Transfer: bank account, ref/trace no., amount.
  - Check: check picker, destination (cashbox/bank), amount (read-only from check).
- Destination pickers follow instrument type rules and existing entity states.

### Phase 6: Validations & Totals (row-level and form-level)
- Row validations: required fields, positive amounts, unique reference per day for card/transfer, valid check state for check rows.
- Form validations: total equals sum of items, single currency assumption, at least one item, destination rules enforced.
- Show inline errors and a summary banner; all messages localized.

### Phase 7: Posting Flow & Status Guardrails
- Implement `Post` action: confirm dialog with summary of destinations and totals.
- Lock edits after posting; allow print/download and view-only.
- Prevent posting if validations fail or server returns referential integrity errors.

### Phase 8: Error Handling & I18N (English + Farsi)
- Add i18n keys for Receipt page: titles, fields, item types, dialogs, validations, errors, success.
- Ensure Farsi translations with RTL alignment; keep `en.json` and `fa.json` in sync.
- Map server errors to friendly messages (e.g., referenced by checkbook, bank account references) via a helper.

### Phase 9: Printing & Attachments (basic, consistent with current system)
- Implement a simple printable layout for posted receipts (header, items, totals).
- Support basic attachments field on the form (optional) where infrastructure allows.

### Phase 10: QA, Accessibility, RTL, Performance
- Keyboard navigation across item rows; focus management on add/remove.
- RTL-specific checks for layout and numeric input alignment.
- Smoke test with mock and real API; handle slow networks with loading and retry patterns.

### Phase 11: Documentation & Handoff
- Developer README for routes, components, types, and service methods.
- Notes on posting behavior, validation rules, and error mapping.
- Explicit reminder: function-level comments included across new code; Farsi translations for all UI labels.

## Deliverables Per Phase
- Clear UI behavior for drafts vs posted receipts.
- Consistent error messaging and i18n coverage (English/Farsi).
- Fully commented service and component functions.
- Non-invasive integration: no changes to Cashbox, Bank Manager, or Check Manager.

## Acceptance Criteria (MVP)
- Create/edit a draft receipt with multiple item types.
- Post a receipt successfully and lock edits upon posting.
- Show localized error messages on validation and server failures.
- List view with filters and basic actions (view, edit draft, print, delete draft).
- Farsi translation parity for all visible labels and dialogs; proper RTL layout.

## I18N Notes
- All newly added UI labels must have `en` and `fa` entries.
- Error keys mapped from backend should resolve to readable English/Farsi strings.
- Validate RTL spacing and number formatting on the Receipts pages.

## Out of Scope
- Modifications to Cashbox, Bank Manager, or Check Manager.
- Multi-currency handling (explicitly deferred at this stage).

## Next Step
If this plan looks good, specify the phase to start with and we will proceed with coding accordingly.