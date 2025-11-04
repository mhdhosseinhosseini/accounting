# I18N Plan (Farsi-first)

This document defines the internationalization structure for both backend and frontend with Farsi as the default language and English as the secondary.

## Principles
- Farsi-first: all user-visible labels, messages, and errors must have Farsi translations.
- English fallback: provide English equivalents for debugging and non-Farsi users.
- Keys are stable, descriptive, and namespaced per domain.

## Backend Catalogs
- Location (proposal, no code yet): `accounting/back-end/src/i18n/` with per-namespace JSON or TS catalogs.
- Namespaces:
  - `common`: generic strings (ok, cancel, error, success)
  - `auth`: OTP flows, login, tokens, errors
  - `users`: profile, permissions
  - `accounting`: journals, invoices, payments
  - `validation`: input validation messages
- Example keys:
  - `auth.otpSent`: "کد تأیید برای شما ارسال شد" / "Verification code sent"
  - `auth.otpFailed`: "ارسال کد ناموفق بود" / "Failed to send OTP"
  - `auth.invalidMobile`: "شماره موبایل نامعتبر است" / "Invalid mobile number"
  - `accounting.journal.created`: "سند حسابداری ثبت شد" / "Journal entry created"
  - `accounting.invoice.paid`: "فاکتور پرداخت شد" / "Invoice marked as paid"
  - `validation.required`: "این فیلد الزامی است" / "This field is required"

## Frontend Catalogs
- Location: `accounting/front-end/src/i18n/` with a structure similar to backend.
- Namespaces:
  - `common`, `auth`, `dashboard`, `customers`, `invoices`, `payments`, `reports`, `settings`.
- Example keys:
  - `common.save`: "ذخیره" / "Save"
  - `common.cancel`: "انصراف" / "Cancel"
  - `dashboard.welcome`: "به حسابداری خوش آمدید" / "Welcome to Accounting"
  - `invoices.create`: "ایجاد فاکتور" / "Create Invoice"

## Language Detection
- Backend: detect `Accept-Language` header, default to `fa`.
- Frontend: detect from browser or persist in localStorage; default `fa`.

## Formatting and Locale
- Dates: `fa-IR` locale for Farsi, `en-US` for English.
- Numbers and currency: use Intl APIs with locale-specific formats.

## Implementation Notes
- Maintain consistent keys across backend and frontend namespaces when practical.
- For errors, always provide Farsi messages and ensure English fallback.
- Avoid embedding dynamic values in the string; use templating (e.g., `{count}`).

## Next Actions
- Phase 1: scaffold catalog files and a small translator utility for backend and frontend.
- Phase 2+: fill catalogs as features are built.