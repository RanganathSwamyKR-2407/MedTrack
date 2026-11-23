# MedTrack Implementation Roadmap & Extension Points

## Completed Phases

- **Phase 1 — Repository Analysis & Architecture:** Inspected static HTML/CSS/JS codebase, resolved `#hospitalMap`/`facilities` mismatches, designed modular Express + SQLite + ESP32 architecture.
- **Phase 2 — Hospital & Blood Bank Management (Modules A & B):** SQLite (`sql.js`) migrations, `bcryptjs` + JWT RBAC, interactive Leaflet map facility registration, admin verification, and 8-group blood inventory with timestamped audit history.
- **Phase 3 — Blood Requests & Transportation:** End-to-end request creation, acceptance/rejection, stock deduction on dispatch, and transport box assignment.
- **Phase 4 — OTP Smart Access & Admin Governance (Module C):** CSPRNG OTP generation, HMAC storage, rate-limited verification + lockout, reed-switch door events, and Admin control center.
- **Phase 5 — Temperature Control, GPS Tracking & ESP32 Firmware:** Configurable `4°C–8°C` hysteresis policy, excursion alerts, SVG thermal charts, dual static/moving GPS maps, stale/offline detection, and modular C++ ESP32 drivers + clearly labeled simulation harness.
- **Phase 6 — Testing & Documentation:** Automated unit + integration + security tests (`node --test`) and full `docs/` documentation suite.

## Planned Future Extension Points

1. **PostgreSQL Production Adapter:** Implement `PostgresAdapter` in `backend/db/` using `pg.Pool` and `DB_DRIVER=postgres`.
2. **Additional Environmental & Cargo Sensors:**
   - Humidity (`DHT22`/`SHT31`)
   - Shock & vibration (`MPU6050` IMU)
   - Blood bag weight (`HX711` load cell)
   - Smoke / gas detection (`MQ-2` / `MQ-135`)
   - LiFePO4 battery state-of-charge (`INA219`)
3. **Authentication & Locking Extensions:** MFRC522 RFID/NFC badge verification via `KeypadRfidDriver`; electromagnetic/solenoid lock swap via `IDoorLock`.
4. **Real-Time Protocols & Notifications:** Add MQTT broker / WebSocket server alongside REST `BackendApiClient`, plus Twilio SMS / SendGrid email via `notificationService.registerChannel()`.
5. **OTA Firmware & Fleet Analytics:** Signed firmware updates, multi-stop route optimization, and cold-chain compliance PDF exports.
