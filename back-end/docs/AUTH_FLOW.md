# Authentication Flow — Phase 1

English and Farsi guidance for OTP → JWT authentication in the Accounting backend.

## Overview (English)
- Flow: Request OTP → Verify OTP → Receive `token` (access) + `refreshToken` → Refresh/Logout.
- Localization: Responses honor `Accept-Language` (`fa` or `en`).
- Storage: Refresh tokens are persisted in Postgres (`refresh_tokens`), and revoked during refresh or logout.
- Database: Postgres-only backend; SQLite support has been removed.

### Endpoints
- `POST /api/auth/request-otp` — Request a 6-digit OTP for a mobile number.
- `POST /api/auth/verify-otp` — Verify the OTP and return tokens.
- `POST /api/auth/login` — Alias for `verify-otp` (same request/response).
- `POST /api/auth/refresh` — Rotate refresh token and issue a new pair.
- `POST /api/auth/logout` — Revoke a refresh token.
- `GET  /api/me` — Return current user extracted from the access token.

### Token Lifetimes
- Access token: `JWT_EXPIRES_IN` (default `15m`).
- Refresh token: `REFRESH_TOKEN_EXPIRES_IN` (default `7d`).

### Rate Limiting
- Per-IP: `RATE_LIMIT_REQUEST_OTP_PER_MIN` (default `5`) — simple limiter on `request-otp`.
- Per-mobile: `RATE_LIMIT_REQUEST_OTP_PER_MOBILE_PER_10M` (default `5`) — blocks excessive OTP requests per mobile over 10 minutes.

### Example (Development)
Request OTP:
```
curl -X POST http://localhost:4100/api/auth/request-otp \
  -H 'Content-Type: application/json' \
  -H 'Accept-Language: fa' \
  -d '{"mobileNumber":"09123456789"}'
```
Verify OTP:
```
curl -X POST http://localhost:4100/api/auth/login \
  -H 'Content-Type: application/json' \
  -H 'Accept-Language: en' \
  -d '{"mobileNumber":"09123456789","otp":"123456"}'
```
Refresh:
```
curl -X POST http://localhost:4100/api/auth/refresh \
  -H 'x-refresh-token: <refreshToken>'
```
Logout:
```
curl -X POST http://localhost:4100/api/auth/logout \
  -H 'x-refresh-token: <refreshToken>'
```

### Notes
- In development without SMS credentials, the OTP endpoint returns a `debugCode` field.
- In production with Magfa configured (`MAGFA_USERNAME`, `MAGFA_PASSWORD`, `MAGFA_DOMAIN`), SMS failures return 500.

---

## راهنمای فارسی
- جریان: درخواست رمز یکبارمصرف → اعتبارسنجی رمز → دریافت `token` (دسترسی) و `refreshToken` → به‌روزرسانی/خروج.
- بومی‌سازی: پاسخ‌ها بر اساس `Accept-Language` به فارسی یا انگلیسی برگردانده می‌شوند.
- ذخیره‌سازی: توکن‌های رفرش در پایگاه داده PostgreSQL (`refresh_tokens`) ذخیره می‌شوند و هنگام به‌روزرسانی یا خروج باطل می‌گردند.
- پایگاه داده: فقط PostgreSQL؛ پشتیبانی از SQLite حذف شده است.

### اندپوینت‌ها
- `POST /api/auth/request-otp` — درخواست رمز ۶ رقمی برای شماره موبایل.
- `POST /api/auth/verify-otp` — اعتبارسنجی رمز و صدور توکن‌ها.
- `POST /api/auth/login` — نام مستعار برای `verify-otp` (درخواست/پاسخ یکسان).
- `POST /api/auth/refresh` — گردش توکن رفرش و صدور جفت جدید.
- `POST /api/auth/logout` — باطل کردن توکن رفرش.
- `GET  /api/me` — کاربر فعلی استخراج‌شده از توکن دسترسی.

### عمر توکن‌ها
- توکن دسترسی: `JWT_EXPIRES_IN` (پیش‌فرض `15m`).
- توکن رفرش: `REFRESH_TOKEN_EXPIRES_IN` (پیش‌فرض `7d`).

### محدودسازی نرخ
- بر اساس IP: `RATE_LIMIT_REQUEST_OTP_PER_MIN` (پیش‌فرض `5`) — محدودکننده ساده روی `request-otp`.
- بر اساس شماره موبایل: `RATE_LIMIT_REQUEST_OTP_PER_MOBILE_PER_10M` (پیش‌فرض `5`) — جلوگیری از درخواست‌های بیش‌ازحد برای هر موبایل طی ۱۰ دقیقه.

### نمونه‌ها (توسعه)
درخواست رمز:
```
curl -X POST http://localhost:4100/api/auth/request-otp \
  -H 'Content-Type: application/json' \
  -H 'Accept-Language: fa' \
  -d '{"mobileNumber":"09123456789"}'
```
ورود (اعتبارسنجی رمز):
```
curl -X POST http://localhost:4100/api/auth/login \
  -H 'Content-Type: application/json' \
  -H 'Accept-Language: fa' \
  -d '{"mobileNumber":"09123456789","otp":"123456"}'
```
به‌روزرسانی:
```
curl -X POST http://localhost:4100/api/auth/refresh \
  -H 'x-refresh-token: <refreshToken>'
```
خروج:
```
curl -X POST http://localhost:4100/api/auth/logout \
  -H 'x-refresh-token: <refreshToken>'
```

### نکات
- در حالت توسعه بدون تنظیمات SMS، اندپوینت OTP مقدار `debugCode` را بازمی‌گرداند.
- در تولید با پیکربندی مگفا (`MAGFA_USERNAME`, `MAGFA_PASSWORD`, `MAGFA_DOMAIN`)، خطاهای ارسال SMS با وضعیت ۵۰۰ برگردانده می‌شوند.