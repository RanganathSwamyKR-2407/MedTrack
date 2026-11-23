# MedTrack REST API Documentation (`/api/v1`)

Machine-readable OpenAPI 3.0 specification is served live at `GET /api/v1/docs`.

## Authentication Headers

- **User / Dashboard Endpoints:** `Authorization: Bearer <JWT>`
- **IoT Hardware Endpoints:** `X-Device-Id: <DEVICE_UID>` and `X-Device-Key: <RAW_DEVICE_API_KEY>`

## Standard Error Format

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": []
  }
}
```

## Endpoint Groups

### Auth (`/api/v1/auth`)
- `POST /register` — Create `patient`, `hospital`, or `blood_bank` account.
- `POST /login` — Authenticate and receive JWT + user/facility context.
- `GET /me` — Retrieve authenticated profile.
- `POST /verify-contact` — Verify email/phone code.

### Hospitals (`/api/v1/hospitals`)
- `POST /register` — Full hospital onboarding with registration number, address, PIN, and map coordinates (`pending` until admin approval).
- `GET /` — List/search approved hospitals (`?search=`, `?city=`, `?lat=&lng=`).
- `GET /nearby` — Radius search (`?lat=&lng=&radiusKm=`).
- `GET /my/profile` — Fetch authenticated hospital's profile.
- `GET /:id` — Hospital details.
- `PATCH /:id` — Update profile, map coordinates, beds, ambulances, or facilities.

### Blood Banks & Inventory (`/api/v1/blood-banks`, `/api/v1/inventory`)
- `POST /blood-banks/register` — Blood bank onboarding (`pending` until admin approval).
- `GET /blood-banks` & `GET /blood-banks/nearby` — Discover approved blood banks.
- `GET /inventory/search` — Search across all 8 groups (`?bloodGroup=O-&city=Pune&onlyAvailable=true&lat=&lng=`).
- `GET /inventory/bank/:bankId` — View all 8 groups for a bank.
- `PUT /inventory/bank/:bankId` — Update stock quantity & thresholds (records `inventory_history`).
- `GET /inventory/bank/:bankId/history` — View timestamped inventory audit history.

### Blood Requests & Transport (`/api/v1/blood-requests`, `/api/v1/transport`)
- `POST /blood-requests` — Create blood request.
- `GET /blood-requests` — List role-scoped requests.
- `PATCH /blood-requests/:id/accept` / `PATCH /blood-requests/:id/reject` — Blood bank decision.
- `POST /transport/dispatch` — Deduct stock, record inventory history, and assign IoT box.
- `GET /transport` & `GET /transport/:id` — List/inspect transports.
- `PATCH /transport/:id/deliver` — Confirm delivery.

### IoT Devices, Telemetry & OTP Access
- `POST /devices/register` — Provision device & issue one-time API key.
- `GET /devices` & `PATCH /devices/:id/config` — List devices (`online`/`stale`/`offline`) & update cooling thresholds.
- `POST /devices/:id/heartbeat` — Device heartbeat (device auth).
- `POST /sensors/readings` — Extensible sensor ingestion (device auth).
- `POST /sensors/simulate` — Development-only simulation endpoint (`SIMULATION_MODE=true`).
- `GET /temperature/:deviceId/history` & `GET /temperature/:deviceId/excursions` — Thermal chart series, stale flag, and excursions.
- `POST /gps/update` (device auth) & `GET /gps/:transportId/route` — Live box coordinates and journey polyline.
- `POST /otp/generate` — Issue single-use CSPRNG 6-digit OTP (stored as HMAC-SHA256 hash).
- `POST /otp/verify` — Rate-limited hardware OTP verification returning short-lived `unlockToken`.
- `POST /access/door-event` — Reed-switch `door_opened` / `door_closed` logging (triggers `unauthorized_door_open` alert if no valid unlock token).
- `GET /alerts` & `PATCH /alerts/:id/acknowledge` — Role-scoped alerts.
- `GET /admin/overview`, `PATCH /admin/facilities/:type/:id/verify`, `GET /admin/users`, `PATCH /admin/users/:id/role`, `GET /admin/health`, `GET /admin/audit-logs`.
