#ifndef DS18B20_TEMP_SENSOR_H
#define DS18B20_TEMP_SENSOR_H

#include <OneWire.h>
#include <DallasTemperature.h>
#include "ITempSensor.h"

class DS18B20TempSensor : public ITempSensor {
private:
  OneWire oneWire;
  DallasTemperature sensors;

public:
  explicit DS18B20TempSensor(uint8_t pin) : oneWire(pin), sensors(&oneWire) {}

  void begin() override {
    sensors.begin();
    sensors.setResolution(12);
  }

  TempReading readCelsius() override {
    sensors.requestTemperatures();
    float tempC = sensors.getTempCByIndex(0);

    // Reject disconnected (-127C) or power-on reset (85C) or out-of-range values
    if (tempC <= -100.0f || tempC == 85.0f || tempC > 125.0f || isnan(tempC)) {
      return { false, 0.0f, "DS18B20 sensor disconnected or invalid reading" };
    }
    return { true, tempC, nullptr };
  }
};

#endif
