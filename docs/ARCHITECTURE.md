# MedTrack Architecture

## Overview

MedTrack extends the original static HTML/CSS/JS healthcare discovery platform with a modular Node.js/Express REST API (`/api/v1`), a driver-abstracted relational database layer (`sql.js` SQLite with a PostgreSQL migration path), role-based dashboards (`hospital`, `blood_bank`, `admin`, `patient`), and an ESP32 IoT blood transportation cooler firmware stack.

## Layer Responsibilities

1. **Presentation Layer (Root HTML/CSS + `js/`)**
   - Preserves all original public pages (`index.html`, `hospitals.html`, `hospital.html`, `emergency.html`, `ambulance.html`, `blood.html`, `login.html`, `register.html`).
   - Adds role-scoped portals (`hospital-dashboard.html`, `blood-bank-dashboard.html`, `admin-dashboard.html`, `hospital-register.html`).
   - Uses `js/api-client.js` for Bearer JWT requests and `js/iot-monitor.js` for Leaflet journey trails and SVG temperature charts. Browser JavaScript never communicates directly with ESP32 hardware.

2. **API & Domain Layer (`backend/`)**
   - `backend/config/env.js`: Centralized environment thresholds and secrets configuration.
   - `backend/middleware/`: JWT authentication & RBAC (`auth.js`), Zod payload validation (`validate.js`), sliding-window rate limiting (`rateLimit.js`), uniform error handling (`errorHandler.js`).
   - `backend/modules/`: Isolated domain routers and services (`auth`, `hospitals`, `blood-banks`, `blood-requests`, `transport`, `devices`, `telemetry`, `otp-access`, `alerts`, `admin`).
   - `backend/services/notificationService.js`: Pluggable notification gateway for in-app alerts and future SMS/Email/Push providers.

3. **Persistence Layer (`backend/db/`)**
   - `adapter.js`: Uniform `queryAll`, `queryOne`, `execute`, `transaction` abstraction backed by `sql.js` (SQLite), ready for a `pg.Pool` PostgreSQL adapter.
   - `migrator.js` + `migrations/001_initial_schema.sql`: Versioned schema migrations.
   - `seed.js`: Idempotent initial seeding preserving the original 8 Indian hospitals alongside blood banks, 8-group stock, IoT devices, and sample transport telemetry.

4. **IoT Controller & Firmware Layer (`firmware/esp32_medtrack/`)**
   - Hardware-independent business policies live in the backend; sensor/actuator drivers live behind clean C++ interfaces (`ITempSensor`, `IDoorLock`, `CoolingPolicyController`, `GpsNeo6mDriver`, `ReedSwitchDriver`, `KeypadRfidDriver`, `LocalAlertDriver`, `BackendApiClient`).

## Future Extension Points

- Swap `SqliteAdapter` for `PostgresAdapter` via `DB_DRIVER=postgres` + `DATABASE_URL`.
- Add MQTT/WebSocket broker bridge alongside REST `BackendApiClient` for sub-second fleet telemetry.
- Register new sensors (`humidity`, `mpu6050_shock`, `hx711_weight`, `mq_gas`, `battery_soc`) in `device_sensors` and post to `POST /api/v1/sensors/readings` with zero schema changes.
- Plug in SMS/Email providers (Twilio/SendGrid) via `notificationService.registerChannel(...)`.
- Swap `ServoLatchDriver` (`IDoorLock`) for solenoid or electromagnetic locks without changing OTP verification logic.
