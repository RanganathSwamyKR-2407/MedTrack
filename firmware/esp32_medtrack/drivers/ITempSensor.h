#ifndef ITEMP_SENSOR_H
#define ITEMP_SENSOR_H

struct TempReading {
  bool valid;
  float celsius;
  const char* errorReason;
};

// Abstract interface allowing DS18B20, SHT31, MAX31865, or dual probes to be swapped cleanly
class ITempSensor {
public:
  virtual ~ITempSensor() {}
  virtual void begin() = 0;
  virtual TempReading readCelsius() = 0;
};

#endif
