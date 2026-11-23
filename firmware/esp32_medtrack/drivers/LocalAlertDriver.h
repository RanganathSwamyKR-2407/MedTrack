#ifndef LOCAL_ALERT_DRIVER_H
#define LOCAL_ALERT_DRIVER_H

#include <Arduino.h>

class LocalAlertDriver {
private:
  uint8_t buzzerPin;
  uint8_t greenLedPin;
  uint8_t redLedPin;

public:
  LocalAlertDriver(uint8_t buzzer, uint8_t greenLed, uint8_t redLed)
    : buzzerPin(buzzer), greenLedPin(greenLed), redLedPin(redLed) {}

  void begin() {
    pinMode(buzzerPin, OUTPUT);
    pinMode(greenLedPin, OUTPUT);
    pinMode(redLedPin, OUTPUT);
    setNormal();
  }

  void setNormal() {
    digitalWrite(greenLedPin, HIGH);
    digitalWrite(redLedPin, LOW);
    digitalWrite(buzzerPin, LOW);
  }

  void signalUnlockSuccess() {
    digitalWrite(greenLedPin, HIGH);
    digitalWrite(redLedPin, LOW);
    tone(buzzerPin, 2000, 180);
  }

  void signalError() {
    digitalWrite(greenLedPin, LOW);
    digitalWrite(redLedPin, HIGH);
    tone(buzzerPin, 800, 350);
  }

  void setTemperatureAlarm(bool active) {
    digitalWrite(redLedPin, active ? HIGH : LOW);
    digitalWrite(greenLedPin, active ? LOW : HIGH);
    if (active) tone(buzzerPin, 1400, 200);
  }
};

#endif
