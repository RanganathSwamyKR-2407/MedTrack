#ifndef REED_SWITCH_DRIVER_H
#define REED_SWITCH_DRIVER_H

#include <Arduino.h>

class ReedSwitchDriver {
private:
  uint8_t pin;
  bool lastOpenState = false;
  unsigned long lastDebounceMs = 0;
  const unsigned long debounceMs = 60;

public:
  explicit ReedSwitchDriver(uint8_t switchPin) : pin(switchPin) {}

  void begin() {
    pinMode(pin, INPUT_PULLUP);
    // Active LOW when magnet is near (door closed); HIGH when door opened
    lastOpenState = (digitalRead(pin) == HIGH);
  }

  bool isDoorOpen() const {
    return lastOpenState;
  }

  // Returns 1 if door just opened, -1 if door just closed, 0 if unchanged
  int pollTransition() {
    bool currentOpen = (digitalRead(pin) == HIGH);
    unsigned long now = millis();
    if (currentOpen != lastOpenState && (now - lastDebounceMs) > debounceMs) {
      lastDebounceMs = now;
      lastOpenState = currentOpen;
      return currentOpen ? 1 : -1;
    }
    return 0;
  }
};

#endif
