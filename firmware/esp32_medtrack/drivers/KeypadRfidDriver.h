#ifndef KEYPAD_RFID_DRIVER_H
#define KEYPAD_RFID_DRIVER_H

#include <Arduino.h>
#include <Keypad.h>

// Supports 4x4 matrix keypad OTP entry (and extensible for MFRC522 RFID UID authentication)
class KeypadRfidDriver {
private:
  static const byte ROWS = 4;
  static const byte COLS = 4;
  char keys[ROWS][COLS] = {
    {'1', '2', '3', 'A'},
    {'4', '5', '6', 'B'},
    {'7', '8', '9', 'C'},
    {'*', '0', '#', 'D'}
  };
  byte rowPins[ROWS] = {13, 18, 19, 21};
  byte colPins[COLS] = {22, 23, 32, 35};
  Keypad keypad;
  String buffer;

public:
  KeypadRfidDriver() : keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS) {}

  // Returns completed 6-digit OTP when '#' is pressed or 6 digits entered
  String pollOtpEntry() {
    char key = keypad.getKey();
    if (!key) return "";

    if (key == '*') {
      buffer = ""; // Clear entry
      return "";
    }
    if (key == '#') {
      if (buffer.length() == 6) {
        String code = buffer;
        buffer = "";
        return code;
      }
      buffer = "";
      return "";
    }
    if (key >= '0' && key <= '9' && buffer.length() < 6) {
      buffer += key;
    }
    return "";
  }
};

#endif
