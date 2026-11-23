# MedTrack Database Design

## Persistence & Migration Strategy

- **Current Driver:** Embedded SQLite via `sql.js` (`./data/medtrack.sqlite` on disk, `:memory:` in automated tests).
- **Migrations:** Versioned SQL scripts in `backend/db/migrations/` tracked by the `schema_migrations` table.
- **PostgreSQL Path:** `backend/db/adapter.js` isolates `queryAll`, `queryOne`, `execute`, and `transaction`. Migrating to PostgreSQL (`pg.Pool`) requires implementing `PostgresAdapter` with `$1, $2...` parameter translation and mapping `INTEGER PRIMARY KEY AUTOINCREMENT` to `SERIAL PRIMARY KEY`.

## Core Tables

| Table | Purpose |
|---|---|
| `users` | Accounts with `bcryptjs` password hashes and RBAC roles (`patient`, `hospital`, `blood_bank`, `admin`) |
| `hospitals` | Registered hospitals, license numbers, lat/lng coordinates, bed counts, facilities, and `verification_status` |
| `blood_banks` | Registered blood banks, license numbers, coordinates, and `verification_status` |
| `blood_inventory` | Stock per blood bank across all 8 groups (`A+`..`AB-`) with configurable `low_threshold`/`critical_threshold` and status (`Sufficient`, `Low`, `Critical`, `Unavailable`) |
| `inventory_history` | Immutable audit log of every stock delta, reason, timestamp, and responsible user |
| `blood_requests` | Hospital/patient blood requests (`pending` → `accepted`/`rejected` → `dispatched` → `delivered`) |
| `devices` | Registered IoT transport boxes, controller model, `capabilities_json`, `cooling_policy_json`, hashed API keys, and `last_seen_at` |
| `device_sensors` | Extensible per-device sensor catalog (`sensor_type`, `unit`, `min_threshold`, `max_threshold`) |
| `transports` | Active and historical shipments linking `blood_request_id`, `device_id`, origin blood bank, and destination hospital |
| `sensor_readings` | Time-series readings for temperature and future sensors (`quality_status`, `cooling_active`, `is_simulated`) |
| `temperature_excursions` | High (`>8°C`), low (`<4°C`), and `sensor_failure` excursion windows with resolution timestamps |
| `gps_locations` | Historical GPS coordinates (`latitude`, `longitude`, `speed_kmh`, `satellites`, `fix_valid`) separate from static hospital coordinates |
| `otp_tokens` | Single-use HMAC-SHA256 hashed OTPs, expiration, failed attempt counters, lockout timestamps, and short-lived unlock token hashes |
| `access_logs` | Door access audit trail (`otp_issued`, `otp_valid`, `otp_invalid`, `lockout`, `unlock_authorized`, `door_opened`, `door_closed`, `unauthorized_door_open`) |
| `alerts` | Role- and facility-targeted operational and security alerts with acknowledgment tracking |
| `audit_logs` | System-wide actor/action/entity compliance log |
