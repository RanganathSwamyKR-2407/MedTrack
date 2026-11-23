#include <WiFi.h>
#include "config.h" // Copy from config.example.h and set local Wi-Fi + provisioned device API key
#include "drivers/DS18B20TempSensor.h"
#include "drivers/CoolingPolicyController.h"
#include "drivers/GpsNeo6mDriver.h"
#include "drivers/IDoorLock.h"
#include "drivers/ReedSwitchDriver.h"
#include "drivers/KeypadRfidDriver.h"
#include "drivers/LocalAlertDriver.h"
#include "network/BackendApiClient.h"

DS18B20TempSensor tempSensor(PIN_TEMP_ONEWIRE);
PeltierRelayDriver peltierDriver(PIN_PELTIER_RELAY);
CoolingPolicyController coolingPolicy(TEMP_MIN_C, TEMP_MAX_C, TEMP_HYSTERESIS_C, PELTIER_MIN_SWITCH_INTERVAL_MS);
GpsNeo6mDriver gpsDriver(2, PIN_GPS_RX, PIN_GPS_TX);
ServoLatchDriver doorLock(PIN_SERVO_LATCH);
ReedSwitchDriver reedSwitch(PIN_REED_SWITCH);
KeypadRfidDriver keypadInput;
LocalAlertDriver alertDriver(PIN_BUZZER, PIN_LED_OK, PIN_LED_ALERT);
BackendApiClient apiClient(BACKEND_BASE_URL, DEVICE_UID, DEVICE_API_KEY);

unsigned long lastTempMs = 0;
unsigned long lastGpsMs = 0;
unsigned long lastHeartbeatMs = 0;
unsigned long unlockStartedMs = 0;
String activeUnlockToken = "";

void ensureWifiConnected() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void setup() {
  Serial.begin(115200);
  tempSensor.begin();
  peltierDriver.begin();
  gpsDriver.begin(9600);
  doorLock.begin();
  reedSwitch.begin();
  alertDriver.begin();

  WiFi.mode(WIFI_STA);
  ensureWifiConnected();
}

void loop() {
  unsigned long now = millis();
  gpsDriver.poll();

  // 1. Auto-relock servo after configured unlock hold window
  if (doorLock.isUnlocked() && (now - unlockStartedMs > UNLOCK_HOLD_MS)) {
    doorLock.lock();
    activeUnlockToken = "";
  }

  // 2. Poll keypad OTP entry -> verify with backend -> actuate decoupled door lock
  String enteredOtp = keypadInput.pollOtpEntry();
  if (enteredOtp.length() == 6) {
    OtpVerifyResponse auth = apiClient.verifyOtp(enteredOtp);
    if (auth.authorized) {
      activeUnlockToken = auth.unlockToken;
      unlockStartedMs = now;
      doorLock.unlock();
      alertDriver.signalUnlockSuccess();
    } else {
      alertDriver.signalError();
    }
  }

  // 3. Poll magnetic reed switch for physical door open/close events
  int doorTransition = reedSwitch.pollTransition();
  if (doorTransition == 1) {
    apiClient.sendDoorEvent("door_opened", activeUnlockToken);
  } else if (doorTransition == -1) {
    apiClient.sendDoorEvent("door_closed", activeUnlockToken);
  }

  // 4. Periodic temperature reading + local hysteresis cooling policy + backend upload & policy sync
  if (now - lastTempMs >= TELEMETRY_INTERVAL_MS) {
    lastTempMs = now;
    TempReading reading = tempSensor.readCelsius();
    coolingPolicy.evaluateAndAct(reading.celsius, reading.valid, peltierDriver);
    alertDriver.setTemperatureAlarm(
      !reading.valid || reading.celsius > coolingPolicy.getMaxC() || reading.celsius < coolingPolicy.getMinC()
    );
    apiClient.sendTemperature(reading.celsius, !reading.valid, peltierDriver.isCooling(), &coolingPolicy);
  }

  // 5. Periodic GPS Neo-6M coordinate upload (also reports fixValid=false when GPS fix is lost)
  if (now - lastGpsMs >= GPS_INTERVAL_MS) {
    lastGpsMs = now;
    GpsFix fix = gpsDriver.getFix();
    if (fix.valid) {
      apiClient.sendGps(fix.latitude, fix.longitude, fix.speedKmh, fix.satellites, fix.hdop, true);
    } else {
      apiClient.sendGps(0.0, 0.0, 0.0, 0, 99.0, false);
    }
  }

  // 6. Periodic device heartbeat to report online health and pull updated thresholds
  if (now - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatMs = now;
    apiClient.sendHeartbeat(&coolingPolicy);
  }
}
