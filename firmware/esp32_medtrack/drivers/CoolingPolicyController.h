#ifndef COOLING_POLICY_CONTROLLER_H
#define COOLING_POLICY_CONTROLLER_H

#include <Arduino.h>

class PeltierRelayDriver {
private:
  uint8_t controlPin;
  bool active = false;

public:
  explicit PeltierRelayDriver(uint8_t pin) : controlPin(pin) {}

  void begin() {
    pinMode(controlPin, OUTPUT);
    setCooling(false);
  }

  // Drives opto-isolated relay / logic-level MOSFET controlling 12V Peltier + heatsink fans
  void setCooling(bool enable) {
    active = enable;
    digitalWrite(controlPin, enable ? HIGH : LOW);
  }

  bool isCooling() const { return active; }
};

class CoolingPolicyController {
private:
  float minC;
  float maxC;
  float hysteresisC;
  unsigned long minSwitchIntervalMs;
  unsigned long lastSwitchMs = 0;

public:
  CoolingPolicyController(float minTemp, float maxTemp, float hyst, unsigned long minIntervalMs)
    : minC(minTemp), maxC(maxTemp), hysteresisC(hyst), minSwitchIntervalMs(minIntervalMs) {}

  void updateThresholds(float minTemp, float maxTemp, float hyst) {
    if (minTemp < maxTemp) {
      minC = minTemp;
      maxC = maxTemp;
      hysteresisC = hyst;
    }
  }

  void evaluateAndAct(float tempC, bool sensorValid, PeltierRelayDriver& driver) {
    unsigned long now = millis();
    if (!sensorValid) {
      // Fail-safe off on sensor fault
      if (driver.isCooling()) {
        driver.setCooling(false);
        lastSwitchMs = now;
      }
      return;
    }

    if (now - lastSwitchMs < minSwitchIntervalMs) {
      return; // Prevent rapid relay/Peltier thermal cycling
    }

    float turnOnAt = maxC - hysteresisC;
    float turnOffAt = minC + hysteresisC;

    if ((tempC > maxC || tempC >= turnOnAt) && !driver.isCooling()) {
      driver.setCooling(true);
      lastSwitchMs = now;
    } else if ((tempC < minC || tempC <= turnOffAt) && driver.isCooling()) {
      driver.setCooling(false);
      lastSwitchMs = now;
    }
  }

  float getMinC() const { return minC; }
  float getMaxC() const { return maxC; }
};

#endif
