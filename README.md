# 🏥 MedTrack India — Smart Blood Availability & IoT Blood Transportation Platform

MedTrack India combines intelligent hospital & blood bank discovery with an extensible **IoT-monitored blood transportation system** (`4°C–8°C` cold-chain telemetry, GPS route tracking, and CSPRNG OTP smart door access).

> **Prototype Notice:** The IoT temperature control and Peltier cooling modules are engineering prototypes and are **not clinically validated**. Physical thermal validation and regulatory compliance are required prior to clinical blood transport.

---

## Key Capabilities

- **Existing Public Discovery (Preserved & Upgraded):**
  - `index.html`, `hospitals.html`, `hospital.html`, `emergency.html`, `ambulance.html` with interactive Leaflet maps, geolocation distance ranking, and smart matching backed by `/api/v1/hospitals`.
- **Module A — Hospital Registration & Management:**
  - Dedicated onboarding (`hospital-register.html`) with license/registration number, hospital type, address/PIN, interactive Leaflet map pin picker, `bcryptjs` + JWT RBAC, and Admin verification workflow.
- **Module B — Blood Banks & 8-Group Inventory:**
  - Supports `A+`, `A-`, `B+`, `B-`, `O+`, `O-`, `AB+`, `AB-` with automatic status classification (`Sufficient`, `Low`, `Critical`, `Unavailable`), timestamped `inventory_history`, nearby search (`blood.html`), and request → accept/reject → dispatch lifecycle.
- **Module C — OTP Smart Door Access:**
  - Backend CSPRNG 6-digit OTPs stored only as HMAC-SHA256 hashes, rate limiting + lockout after repeated failures, short-lived unlock tokens, and reed-switch `door_opened`/`door_closed` audit logging.
- **Temperature & GPS Telemetry:**
  - Configurable `4°C–8°C` hysteresis policy, excursion & sensor-failure detection (`-127°C`/`85°C`), SVG temperature history charts, distinct static facility vs. live transport box GPS trails, and `online` / `stale` / `offline` states.
- **Role Dashboards:**
  - Hospital (`hospital-dashboard.html`), Blood Bank (`blood-bank-dashboard.html`), and Administrator (`admin-dashboard.html`).
- **Modular ESP32 Firmware (`firmware/esp32_medtrack/`):**
  - Separate C++ drivers for DS18B20, Peltier relay + hysteresis controller, Neo-6M GPS, Servo latch (`IDoorLock`), Reed switch, 4x4 Keypad, Buzzer/LEDs, and HTTPS REST client.

---

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Configure environment (optional for local dev):**
   Copy `.env.example` to `.env` and set `JWT_SECRET` and `OTP_HMAC_SECRET` in production.
3. **Run the server (runs SQLite migrations & idempotent seed on startup):**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000`.
4. **Run automated tests & checks:**
   ```bash
   npm test
   npm run lint
   npm run build
   ```

## Seeded Demo Accounts (Development)

Password for all seeded demo accounts: `MedTrack@2026` (quick-fill buttons are available on `login.html`):

- **Hospital Staff:** `ruby@medtrack.in` (Ruby Hall Clinic)
- **Blood Bank Coordinator:** `cityblood@medtrack.in` (City Blood Bank)
- **Administrator:** `admin@medtrack.in`
- **Patient:** `patient@medtrack.in`

## Hardware Simulation Mode

When `SIMULATION_MODE=true`, the Hospital Dashboard (`📦 IoT Transport & OTP` tab) includes a clearly labeled **Dev/Test Hardware Simulator** to test temperature excursions, sensor failures, GPS steps, keypad OTP verification, and reed-switch door events without physical ESP32 hardware.

## Architecture & Documentation (`docs/`)

- `docs/ARCHITECTURE.md`
- `docs/DATABASE_DESIGN.md`
- `docs/API_DOCUMENTATION.md` (live OpenAPI JSON at `GET /api/v1/docs`)
- `docs/IOT_INTEGRATION.md`
- `docs/HARDWARE_CONFIGURATION.md`
- `docs/SECURITY.md`
- `docs/IMPLEMENTATION_ROADMAP.md`
