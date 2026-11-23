# MedTrack IoT Integration Guide

## Integration Architecture

```text
[ESP32 Smart Cooler] --(HTTPS REST + X-Device-Id/X-Device-Key)--> [Express /api/v1] --> [SQLite / PostgreSQL]
                                                                          ^
[Browser Dashboards] <---(HTTPS REST + Bearer JWT, polling/SSE)-----------+
```

Browser JavaScript **never** connects directly to the ESP32 over an unsecured link. All hardware telemetry and commands pass through authenticated backend REST APIs. The `BackendApiClient` abstraction in firmware and modular telemetry routes on the backend allow adding an MQTT broker or WebSockets later without rewriting business logic.

## Firmware Modules (`firmware/esp32_medtrack/`)

| Module | File | Responsibility |
|---|---|---|
| Temperature Interface & Driver | `drivers/ITempSensor.h`, `drivers/DS18B20TempSensor.h` | Reads internal chamber °C and flags `-127°C` / `85°C` / `NaN` sensor faults |
| Thermal Control Policy | `drivers/CoolingPolicyController.h` | Enforces configurable `4°C–8°C` bounds, `0.5°C` hysteresis, and minimum switch interval |
| Door Lock Interface & Servo | `drivers/IDoorLock.h`, `drivers/ServoLatchDriver.h` | Decoupled lock abstraction actuated only on backend `unlockAuthorized` response |
| Reed Switch Monitor | `drivers/ReedSwitchDriver.h` | Debounced detection of `door_opened` / `door_closed` events |
| GPS Receiver | `drivers/GpsNeo6mDriver.h` | UART NMEA parsing (`TinyGPSPlus`) for Neo-6M location, speed, and fix validity |
| Keypad Input | `drivers/KeypadRfidDriver.h` | 4x4 matrix keypad 6-digit OTP capture (extensible to MFRC522 RFID) |
| Local Alerts | `drivers/LocalAlertDriver.h` | Piezo buzzer + green/red status LEDs |
| Backend Client | `network/BackendApiClient.h` | Device-authenticated JSON REST client |

## Stale, Offline & Sensor Failure States

- **Online:** `last_seen_at` within `DEVICE_OFFLINE_SECONDS` (120s) and latest reading within `TEMP_STALE_SECONDS` (60s).
- **Stale:** Reading age exceeds `TEMP_STALE_SECONDS` (60s) or `GPS_STALE_SECONDS` (90s); dashboards explicitly mark stale telemetry.
- **Offline:** Device silent beyond `DEVICE_OFFLINE_SECONDS` (120s).
- **Sensor Failure:** DS18B20 disconnect/reset or invalid values trigger `sensor_failure` excursion, critical alert, and fail-safe Peltier shutoff.

## Development Simulation Mode

When `SIMULATION_MODE=true` (non-production), dashboards display a clearly labeled **Dev/Test Hardware Simulator** that posts tagged (`is_simulated = 1`) readings via `/api/v1/sensors/simulate`, `/api/v1/otp/simulate-verify`, and `/api/v1/access/simulate-door-event`.
