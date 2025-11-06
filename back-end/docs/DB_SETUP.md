# Database Setup (PostgreSQL + SQLite) — No Prisma

This backend uses direct database drivers (node-postgres for Postgres, better-sqlite3 for SQLite). Prisma is fully removed.

## Prerequisites
- Node.js 18+
- For Postgres: a reachable PostgreSQL server (local or remote)

## 1) Configure `.env`
- Postgres (English/Farsi):
```
DATABASE_URL="postgresql://<USER>:<PASSWORD>@<HOST>:5432/<DB>?schema=public"
DB_DRIVER=postgres
JWT_SECRET="change-me"
JWT_EXPIRES_IN="15m"
REFRESH_TOKEN_EXPIRES_IN="7d"
RATE_LIMIT_REQUEST_OTP_PER_MIN="5"
```
```
DATABASE_URL="postgresql://<USER>:<PASSWORD>@<HOST>:5432/<DB>?schema=public"
DB_DRIVER=postgres
JWT_SECRET="لطفاً مقدار امن تعیین کنید"
JWT_EXPIRES_IN="15m"
REFRESH_TOKEN_EXPIRES_IN="7d"
RATE_LIMIT_REQUEST_OTP_PER_MIN="5"
```
- SQLite (English/Farsi):
```
DB_DRIVER=sqlite
SQLITE_PATH=../../dev.sqlite
JWT_SECRET="change-me"
JWT_EXPIRES_IN="15m"
REFRESH_TOKEN_EXPIRES_IN="7d"
RATE_LIMIT_REQUEST_OTP_PER_MIN="5"
```
```
DB_DRIVER=sqlite
SQLITE_PATH=../../dev.sqlite
JWT_SECRET="لطفاً مقدار امن تعیین کنید"
JWT_EXPIRES_IN="15m"
REFRESH_TOKEN_EXPIRES_IN="7d"
RATE_LIMIT_REQUEST_OTP_PER_MIN="5"
```

## 2) Dependencies
- Already included in this project:
  - `pg` and `@types/pg`
  - `better-sqlite3` and `@types/better-sqlite3`

## 3) Schema creation
- The server ensures tables on first use (no migrations tool needed):
  - `users`: `id`, `mobile_number (unique)`, `username`, `name`, `role`, `created_at`
  - `refresh_tokens`: `id`, `token (unique)`, `user_id`, `expires_at`, `revoked`, `created_at`
- Switching `DB_DRIVER` will use the appropriate driver automatically.

## 4) Test the connection
- Run the connection test script:
```
npx ts-node src/scripts/testDb.ts
```
- English: If using a remote host like `acc`, ensure it resolves (DNS/hosts). For SQLite, this script is skipped.
- Farsi: اگر از هاست راه‌دور مانند `acc` استفاده می‌کنید، مطمئن شوید نام‌دامنه قابل‌حل است (DNS/hosts). برای SQLite این اسکریپت اجرا نمی‌شود.

## 5) Start the server
```
npm run dev
```
- English: Auth routes will create tables automatically if they don't exist.
- Farsi: مسیرهای احراز هویت در صورت نبود جدول‌ها آن‌ها را خودکار ایجاد می‌کنند.

## Notes
- English:
  - Prisma and its files were removed. Use `DB_DRIVER` to choose Postgres or SQLite.
  - If `acc` host fails (`ENOTFOUND`), use a resolvable hostname/IP or update `/etc/hosts`.
- Farsi:
  - پریزما و فایل‌هایش حذف شدند. برای انتخاب Postgres یا SQLite از `DB_DRIVER` استفاده کنید.
  - اگر هاست `acc` خطا داد (`ENOTFOUND`)، از یک نام‌دامنه یا IP قابل‌حل استفاده کنید یا فایل `/etc/hosts` را به‌روز کنید.