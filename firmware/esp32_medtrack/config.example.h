#ifndef MEDTRACK_CONFIG_H
#define MEDTRACK_CONFIG_H

// Copy this file to config.h and populate with device-specific credentials.
// NEVER commit config.h to version control.

#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// Use HTTPS endpoint in production; set root CA certificate for TLS verification
#define BACKEND_BASE_URL "https://your-medtrack-domain.example/api/v1"
#define DEVICE_UID "MT-BOX-001"
#define DEVICE_API_KEY "REPLACE_WITH_PROVISIONED_DEVICE_API_KEY"

// Pin Configuration (ESP32-WROOM-32)
#define PIN_TEMP_ONEWIRE 4      // DS18B20 temperature probe (4.7k pull-up to 3.3V)
#define PIN_GPS_RX 16           // Neo-6M TX -> ESP32 RX2
#define PIN_GPS_TX 17           // Neo-6M RX -> ESP32 TX2
#define PIN_PELTIER_RELAY 26    // MOSFET/Opto-isolated Relay driver for 12V Peltier + Fan
#define PIN_SERVO_LATCH 27      // PWM signal for electronic door latch servo
#define PIN_REED_SWITCH 33      // Magnetic door reed switch (INPUT_PULLUP, active LOW closed)
#define PIN_BUZZER 25           // Piezo buzzer
#define PIN_LED_OK 12           // Green status LED
#define PIN_LED_ALERT 14        // Red alarm LED

// Configurable Thermal Control Policy (Prototype defaults: 4.0C - 8.0C)
#define TEMP_MIN_C 4.0f
#define TEMP_MAX_C 8.0f
#define TEMP_HYSTERESIS_C 0.5f
#define PELTIER_MIN_SWITCH_INTERVAL_MS 30000UL

// Telemetry Intervals
#define TELEMETRY_INTERVAL_MS 15000UL
#define GPS_INTERVAL_MS 10000UL
#define HEARTBEAT_INTERVAL_MS 30000UL
#define UNLOCK_HOLD_MS 15000UL

#endif
