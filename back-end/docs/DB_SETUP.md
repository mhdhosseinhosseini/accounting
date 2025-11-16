# Database Setup (PostgreSQL) — No Prisma

This backend uses direct database drivers (node-postgres for Postgres). Prisma is fully removed.

## Prerequisites
- Node.js 18+
- A reachable PostgreSQL server (local or remote)

## 1) Configure `.env`
- Postgres (English/Farsi):
```
DATABASE_URL="postgresql://<USER>:<PASSWORD>@<HOST>:5432/<DB>?schema=public"
JWT_SECRET="change-me"
JWT_EXPIRES_IN="15m"
REFRESH_TOKEN_EXPIRES_IN="7d"
RATE_LIMIT_REQUEST_OTP_PER_MIN="5"
RATE_LIMIT_REQUEST_OTP_PER_MOBILE_PER_10M="5"
```
```
DATABASE_URL="postgresql://<USER>:<PASSWORD>@<HOST>:5432/<DB>?schema=public"
JWT_SECRET="لطفاً مقدار امن تعیین کنید"
JWT_EXPIRES_IN="15m"
REFRESH_TOKEN_EXPIRES_IN="7d"
RATE_LIMIT_REQUEST_OTP_PER_MIN="5"
RATE_LIMIT_REQUEST_OTP_PER_MOBILE_PER_10M="5"
```

## 2) Dependencies
- Already included in this project:
  - `pg` and `@types/pg`

## 3) Schema creation
- The server ensures tables on first use (no external migrations tool required):
  - `users`: `id`, `mobile_number (unique)`, `username`, `name`, `role`, `created_at`
  - `refresh_tokens`: `id`, `token (unique)`, `user_id`, `expires_at`, `revoked`, `created_at`

## 4) Test the connection
- Run the connection test script:
```
npx ts-node src/scripts/testDb.ts
```
- English: If using a remote host like `acc`, ensure it resolves (DNS/hosts).
- فارسی: اگر از هاست راه‌دور مانند `acc` استفاده می‌کنید، مطمئن شوید نام‌دامنه قابل‌حل است (DNS/hosts).

## 5) Start the server
```
npm run dev
```
- English: Auth routes will create tables automatically if they don't exist.
- فارسی: مسیرهای احراز هویت در صورت نبود جدول‌ها آن‌ها را خودکار ایجاد می‌کنند.

## Notes
- English:
  - Prisma and its files were removed. Ensure `DATABASE_URL` is set correctly.
  - If the `acc` host fails (`ENOTFOUND`), use a resolvable hostname/IP or update `/etc/hosts`.
- فارسی:
  - پریزما و فایل‌هایش حذف شدند. مطمئن شوید مقدار `DATABASE_URL` به‌درستی تنظیم شده است.
  - اگر هاست `acc` خطا داد (`ENOTFOUND`)، از یک نام‌دامنه یا IP قابل‌حل استفاده کنید یا فایل `/etc/hosts` را به‌روز کنید.