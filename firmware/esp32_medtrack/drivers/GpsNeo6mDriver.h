#ifndef GPS_NEO6M_DRIVER_H
#define GPS_NEO6M_DRIVER_H

#include <HardwareSerial.h>
#include <TinyGPSPlus.h>

struct GpsFix {
  bool valid;
  double latitude;
  double longitude;
  double speedKmh;
  uint32_t satellites;
  double hdop;
};

class GpsNeo6mDriver {
private:
  HardwareSerial serialPort;
  TinyGPSPlus gps;
  uint8_t rxPin;
  uint8_t txPin;

public:
  GpsNeo6mDriver(uint8_t uartIndex, uint8_t rx, uint8_t tx)
    : serialPort(uartIndex), rxPin(rx), txPin(tx) {}

  void begin(unsigned long baud = 9600) {
    serialPort.begin(baud, SERIAL_8N1, rxPin, txPin);
  }

  void poll() {
    while (serialPort.available() > 0) {
      gps.encode(serialPort.read());
    }
  }

  GpsFix getFix() {
    bool valid = gps.location.isValid() && gps.location.age() < 15000;
    return {
      valid,
      valid ? gps.location.lat() : 0.0,
      valid ? gps.location.lng() : 0.0,
      gps.speed.isValid() ? gps.speed.kmph() : 0.0,
      gps.satellites.isValid() ? gps.satellites.value() : 0,
      gps.hdop.isValid() ? gps.hdop.hdop() : 99.9
    };
  }
};

#endif
