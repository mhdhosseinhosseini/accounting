# Treasury (Receipts & Payments) — MARTIN Design

Source: `rp_system.md` (Sepidar Receipt & Payment module review)
Goal: Design the complete needs for a Receipts & Payments subproject (Treasury) compatible with the current GreenBunch stack (Node/Express server, React admin, i18n EN/FA, role-based permissions, audit logging).

## 1. Scope & Objectives
- Manage cash and bank flows: receipts, payments, inter-account transfers.
- Handle check lifecycle: received, issued, assigned, cashed, returned.
- Support card reader/POS settlement and batch imports.
- Provide bank reconciliation from statement files (CSV/Excel).
- Optional multi-currency with exchange-rate handling (feature flag).
- Integrate with sales/purchase modules for invoice settlement.
- Generate or assist in posting accounting entries (link to accounting module).

## 2. Module Overview & Navigation
- New top-level module key: `treasury` (feature-flag-able).
- Admin navigation pages:
  - `Treasury Dashboard` (balances, alerts)
  - `Receipts` (list/create)
  - `Payments` (list/create)
  - `Transfers` (cash↔bank, bank↔bank)
  - `Checks` (received/issued; lifecycle operations)
  - `Bank Reconciliation` (statement import, matching, adjustments)
  - `POS Settlement` (optional)
  - `Reports` (circulation, balances, reconciliation, open docs)

## 3. Domain Entities (core fields)
- `TreasuryAccount` (cashbox/bank/card reader)
  - id, type: `cash|bank|pos`, name, code, bankInfo (number/branch), currency, status: `active|inactive`.
- `Party` (link to customer/supplier/user)
  - id, type: `customer|supplier|other`, refId, name.
- `Document` (base for receipt/payment/transfer)
  - id, docNo, date, type: `receipt|payment|transfer`, status: `draft|approved|posted|reconciled|void`, currency, rate, amount, partyId, accountId, counterAccountId?, reference (invoice/order), notes, createdBy.
- `Cheque` (receivable/payable)
  - id, kind: `received|issued`, bank, number, series, amount, currency, dueDate, partyId, status: `registered|assigned|cashed|returned|void`, holderAccountId?, docRefId?, notes.
- `ReconciliationBatch`
  - id, accountId, periodStart, periodEnd, importedFileMeta, matches%, outstandingItems[], adjustments[], status: `draft|finalized`.
- `POSBatch`
  - id, terminalId, periodStart/End, gross, fees, net, settlementDate, status.
- `AuditLog`
  - id, entityType, entityId, action, actorId, timestamp, payloadDiff.

## 4. Status Models & Controls
- Document: `draft → approved → posted → reconciled` (or `void`).
  - Rules: posting requires balanced entries; void/reverse logs reason.
- Cheque: `registered → assigned → cashed` (or `returned/void`).
  - Alerts for near-due/overdue; state transitions validated.
- Reconciliation: `draft → finalized`; adjustments posted.

## 5. Key Workflows
- Cash receipt (sales/other): select account, party, amount → approve → optional post accounting → visible in balances.
- Vendor payment (purchase): select account, supplier, amount → approve/post → link invoice for settlement.
- Inter-account transfer: source/destination treasury accounts; auto dual entries.
- Cheque lifecycle: register → assign/cash/return; each step records doc refs and updates status.
- Bank statement reconciliation: import CSV/Excel → auto-match on date/amount/ref → review exceptions → create adjustments → finalize.
- POS settlement: import/compute batch → fees → net → post to bank account.

## 6. Validation & Operational Controls
- Mandatory treasury account for any receipt/payment/transfer.
- Party required when linked to sales/purchase settlement.
- Balanced posting only; reject unbalanced documents.
- Duplicate prevention: docNo/cheque number uniqueness per account.
- Currency checks: ensure rate provided when currency ≠ base (if enabled).
- Segregation of duties: registrar vs approver vs reconciler.
- Full audit trail on approve/post/void/reverse/reconcile.

## 7. Permissions & Roles
- Module `treasury` with actions:
  - `createReceipt`, `createPayment`, `createTransfer`
  - `manageCheque`, `importBankStatement`, `runReconciliation`
  - `approveDoc`, `postDoc`, `voidDoc`, `reverseDoc`
  - `listReports`, `viewBalances`
- Example roles:
  - `TreasuryRegistrar`: create docs, manage cheques.
  - `TreasuryApprover`: approve/post, void/reverse.
  - `ReconciliationOfficer`: import statements, finalize reconciliation.
  - `TreasuryAuditor`: read-only reports and audit logs.

## 8. Data Model (tables outline)
- `treasury_accounts`
- `treasury_docs` (receipts/payments/transfers)
- `treasury_doc_lines` (for granular allocations/fees)
- `cheques`
- `reconciliation_batches`, `reconciliation_items`
- `pos_batches`
- `audit_logs`
- Indices: docNo, accountId+date, cheque number, batch periods.

## 9. API Design (server/routes)
- `GET /treasury/accounts`
- `POST /treasury/accounts`
- `GET /treasury/docs?type=&status=&partyId=&accountId=&from=&to=`
- `POST /treasury/docs` (receipt/payment/transfer)
- `POST /treasury/docs/:id/approve`
- `POST /treasury/docs/:id/post`
- `POST /treasury/docs/:id/void`
- `POST /treasury/docs/:id/reverse`
- `GET /treasury/cheques?status=&kind=&partyId=`
- `POST /treasury/cheques` (register)
- `POST /treasury/cheques/:id/assign|cash|return|void`
- `POST /treasury/reconciliation/import` (CSV/Excel upload)
- `POST /treasury/reconciliation/:batchId/match`
- `POST /treasury/reconciliation/:batchId/adjustments`
- `POST /treasury/reconciliation/:batchId/finalize`
- `POST /treasury/pos/settlements`
- `GET /treasury/reports/...` (balances, circulation, reconciliation)
- Integration hooks: create settlement links with `/sales/invoices/:id/settle` and `/purchase/invoices/:id/settle`.

## 10. UI/Pages (admin)
- Lists: Receipts, Payments, Transfers, Cheques, Reconciliation Batches, POS Batches.
- Forms: Create/Edit Receipt/Payment/Transfer; Cheque operations; Reconciliation import/match/finalize.
- Dashboard: balances by account, overdue cheques, unresolved matches, quick actions.
- Reports: filters by date, account, party, status; export CSV/XLSX; print.
- States: `draft/approved/posted/reconciled/void` with badges and guarded actions.

## 11. i18n (EN/FA keys)
- Module: `treasury.title`, `treasury.dashboard.title`
- Pages: `treasury.receipts.title`, `treasury.payments.title`, `treasury.transfers.title`, `treasury.cheques.title`, `treasury.reconciliation.title`, `treasury.pos.title`, `treasury.reports.title`
- Fields: `treasury.account`, `treasury.party`, `treasury.amount`, `treasury.currency`, `treasury.rate`, `treasury.date`, `treasury.status`
- Actions: `treasury.approve`, `treasury.post`, `treasury.void`, `treasury.reverse`, `treasury.import`, `treasury.finalize`
- Messages: `treasury.validation.requiredAccount`, `treasury.validation.balancedOnly`, `treasury.alerts.chequeDueSoon`

## 12. Reports
- Cheque circulation by status/kind/date/party.
- Bank statement reconciliation summary with match% and outstanding.
- Unposted/unreconciled receipts & payments.
- POS settlement summary.
- Treasury balances (daily/weekly/monthly) with filters.

## 13. Integration Points
- Accounting: posting entries (via accounting service/API); enforce balanced entries.
- Sales/Purchase: invoice settlement linking to receipts/payments.
- Uploads: CSV/XLSX parsers for bank/POS statements with bank-specific adapters.

## 14. Non-Functional Requirements
- Audit logging on all state transitions.
- Role-based access control using existing PermissionContext.
- Import performance: process ≥5k rows per batch with progress & resumable uploads.
- Consistent date/time and currency handling; configurable base currency.

## 15. Acceptance Tests (from rp_system.md)
- Cash receipt → post → balance correct.
- Cheque receipt → cash on due date → track in reports.
- Bank statement import → auto reconciliation → show match% and balances.
- Inter-bank transfer → dual entries → balances updated.
- Vendor payment → settlement linked to purchase invoice.
- Unauthorized user cannot post/void/delete.
- Currency transaction (if enabled) → conversion document generated.

## 16. Implementation Plan (phased)
1) Entities & DB schema; minimal API; lists/forms in admin.
2) Cheque lifecycle operations; alerts; reports v1.
3) Reconciliation: import, auto-match, adjustments, finalize.
4) POS settlement; bank adapters; performance tuning.
5) Accounting posting integration; full audit & permissions.
6) i18n EN/FA coverage; print/export templates; hardening.

Notes
- Multi-currency behind feature flag; enable per customer policy.
- Bank/POS file formats vary—use pluggable parsers/adapters.
- Keep UI labels EN/FA updated per i18n keys above.