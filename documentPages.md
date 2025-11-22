Pages

- Documents List
  
  - Table lists header fields and quick line summaries (count, top accounts).
  - Per-row actions: Edit , Delete , Print , Confirm .
  - Global action: New Document to open data entry form.
  - Row expand/drawer shows full journal lines without leaving list.
- Document Entry
  
  - Header form: number, Jalali date, type, description, reference, status (read-only).
  - Detail lines grid: account code selector, cost center (optional), line description, debit, credit, reference.
  - Footer totals: debit total, credit total, difference; finalize disabled unless balanced.
  - Attachments panel: upload, list, delete.
  - Actions: save draft, finalize/confirm, cancel, print.
Search

- Filters on header fields: document_no , date (Jalali range) , type , provider , status , ref_no .
- Filters on line fields: account code , cost center , line description , party , amount ranges , reference .
- Free-text search across header + line descriptions; respects Persian characters normalization ( ي → ی ).
- Server-side pagination, sort by date/number/status; results show totals and match indicators.
Row Actions (List Page)

- Edit: opens entry page with selected document in draft or final allowing permitted edits.
- Delete: only allowed for draft ; soft-delete or status to canceled based on policy.
- Print: generates PDF/HTML rendition for any status; includes header, lines, totals, signatures.
- Confirm: finalizes a draft when balanced; sets status to final .
Backend Requirements

- Endpoints
  - GET /api/documents with query filters for header and line fields; returns paged results.
  - POST /api/documents create draft; PUT /api/documents/:id update draft.
  - GET /api/documents/:id fetch with header, lines, attachments, totals.
  - DELETE /api/documents/:id delete (or cancel) respecting status rules.
  - POST /api/documents/:id/finalize finalize when balanced; POST /api/documents/:id/cancel cancel with reason.
  - GET /api/documents/:id/print printable output (PDF/HTML).
  - GET /api/codes and GET /api/cost-centers for selectors; GET /api/parties if used.
- Validation
  - Per line: exactly one of debit or credit > 0; code_id must be valid.
  - Document: SUM(debit) = SUM(credit) to finalize; enforce required details/cost center by account policy.
  - Input normalization: replace ي → ی on all text fields server-side.
- Data model
  - journals : add document_no , type , description , provider_user_id , extended status .
  - journal_items : add optional cost_center_id ; enforce XOR check on debit/credit.
  - attachments and journal_attachments tables if not present.
- Search implementation
  - Indexed filters: journals(document_no, date, type, status, ref_no) .
  - Line filters: composite index journal_items(journal_id, code_id) ; partial indexes for text fields if needed.
  - Optional full-text via tsvector on journals.description and journal_items.description .
- Jalali dates
  - Accept Jalali in API; convert to Gregorian for storage; provide Jalali in responses when Accept-Language: fa .
- Workflow & security
  - Status transitions: draft → final → approved ; canceled terminal.
  - Role gating: confirm allowed for normal users; approve/cancel restricted to admin.
  - Audit logs for create/edit/finalize/cancel/print actions.
  - Idempotent finalize/approve endpoints; safe error returns with i18n keys.
Frontend Requirements

- Documents List
  - Filter bar with header + line field filters; free-text search input.
  - Table columns: number, date (Jalali), type, provider, status, totals, match highlights.
  - Row actions as buttons; row expand or side drawer for line details.
  - New Document button prominent; state preserved when returning from entry page.
- Document Entry
  - Header inputs with Jalali date picker; status badge; auto provider.
  - Lines grid: typeahead selectors for accounts/cost centers; numeric inputs with validation.
  - Real-time totals and difference; finalize button disabled until balanced.
  - Attachments area with upload and list; drag-and-drop optional.
  - Bilingual labels and messages via t() ; Farsi defaults for local users as configured.
- UX
  - Sticky actions bar; unsaved changes prompt; keyboard-friendly grid.
  - Toasts/dialogs for validation errors: “Account code is invalid”, “Document is not balanced”, “Details required”.
  - Print preview modal or new window.
I18n & Persian Support

- All labels/messages include Persian translations; respect Accept-Language .
- Jalali date entry; Gregorian storage/printing options.
- Text normalization ensures 'ي' is stored/displayed as 'ی' .
Performance & Reliability

- Server-side pagination and sorting; debounce search inputs.
- Optimistic locking via updated_at or ETag to prevent lost updates.
- Clear, typed error responses; audit logs for traceability.
Acceptance Criteria

- List page searches across header and line fields and returns paged results.
- Row actions behave per status rules; confirm only when balanced; delete only for draft .
- Entry page enforces mutual exclusivity of debit/credit; finalize disabled until difference is zero.
- Print yields accurate PDF/HTML for any status; includes all necessary fields.
- All UI and messages are available in Persian and English; Jalali input works consistently.
Decisions Needed

- Document numbering policy (manual vs auto, per fiscal year).
- Whether cost centers live in codes or a dedicated table.
- Print layout specifics (branding, signatures, stamps).
- Any additional filters for list page (provider, fiscal year, totals range).
