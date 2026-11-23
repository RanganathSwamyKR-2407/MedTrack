#ifndef IDOOR_LOCK_H
#define IDOOR_LOCK_H

#include <ESP32Servo.h>

// Abstract door lock interface so solenoid or magnetic locks can replace Servo without changing OTP logic
class IDoorLock {
public:
  virtual ~IDoorLock() {}
  virtual void begin() = 0;
  virtual void unlock() = 0;
  virtual void lock() = 0;
  virtual bool isUnlocked() const = 0;
};

class ServoLatchDriver : public IDoorLock {
private:
  uint8_t servoPin;
  Servo latchServo;
  bool unlockedState = false;
  int lockedAngle;
  int unlockedAngle;

public:
  ServoLatchDriver(uint8_t pin, int lockedDeg = 0, int unlockedDeg = 90)
    : servoPin(pin), lockedAngle(lockedDeg), unlockedAngle(unlockedDeg) {}

  void begin() override {
    latchServo.attach(servoPin);
    lock();
  }

  void unlock() override {
    latchServo.write(unlockedAngle);
    unlockedState = true;
  }

  void lock() override {
    latchServo.write(lockedAngle);
    unlockedState = false;
  }

  bool isUnlocked() const override {
    return unlockedState;
  }
};

#endif
