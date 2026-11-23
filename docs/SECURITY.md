# MedTrack Security Architecture

## Authentication & Role-Based Access Control (RBAC)

- **Password Hashing:** `bcryptjs` with cost factor `10`. Plaintext passwords are never stored in the database or browser `localStorage`.
- **Session Tokens:** Signed JWTs (`jsonwebtoken`) containing user ID, email, and role (`patient`, `hospital`, `blood_bank`, `admin`).
- **Role Separation:**
  - `patient`: Public discovery, emergency lookup, personal blood requests.
  - `hospital`: Manage own hospital beds/profile/location, request blood, generate recipient OTPs, monitor assigned transports.
  - `blood_bank`: Manage own 8-group blood inventory, accept/reject requests, dispatch IoT transport boxes.
  - `admin`: Approve/reject facility registrations, manage user roles, register devices, inspect system health and audit logs.
  - Self-registration cannot assign `admin` role.

## OTP Smart Door Access Security (Module C)

- **CSPRNG Generation:** 6-digit numeric OTP generated exclusively on the backend using Node.js `crypto.randomInt(100000, 1000000)`.
- **Non-Plaintext Storage:** Only HMAC-SHA256 digests (`OTP_HMAC_SECRET`) are persisted in `otp_tokens`. Comparisons use `crypto.timingSafeEqual`.
- **Single-Use & Expiry:** Default TTL `300s` (`OTP_TTL_SECONDS`). Generating a new OTP invalidates prior unused OTPs; verifying marks `used_at` immediately.
- **Rate Limiting & Lockout:** Sliding-window API rate limiting plus per-OTP `failed_attempts` counter triggering temporary lockout (`OTP_LOCKOUT_SECONDS`, default `900s`) and critical security alert after `5` failed entries.
- **Short-Lived Unlock Token:** Successful OTP validation returns a 60-second unlock authorization token; physical door openings (`reed_switch`) without a valid recent authorization trigger `unauthorized_door_open` security alerts.

## Device & Transport Security

- **Device Authentication:** ESP32 devices authenticate with `X-Device-Id` and `X-Device-Key` headers verified via SHA-256 hash + `crypto.timingSafeEqual`. Keys are shown once on provisioning (`POST /api/v1/devices/register`) and stored in gitignored `config.h`.
- **Secrets Management:** All secrets (`JWT_SECRET`, `OTP_HMAC_SECRET`, `DATABASE_URL`) reside in environment variables (`.env.example` template only).
- **Input Validation & Headers:** Strict Zod schemas on all `POST`/`PUT`/`PATCH` payloads and `helmet` HTTP security headers.
