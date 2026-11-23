import { config } from "../../config/env.js";

/**
 * Evaluates a temperature reading against configurable thresholds and hysteresis.
 * Never claims clinical validation; provides prototype thermal policy decisions.
 *
 * @param {object} params
 * @param {number|null} params.temperatureC
 * @param {boolean} [params.sensorErrorFlag]
 * @param {boolean} [params.currentlyCooling]
 * @param {object} [params.policy]
 */
export function evaluateTemperaturePolicy({
  temperatureC,
  sensorErrorFlag = false,
  currentlyCooling = false,
  policy = {}
}) {
  const minC = Number(policy.targetMinC ?? config.telemetry.tempMinC);
  const maxC = Number(policy.targetMaxC ?? config.telemetry.tempMaxC);
  const hysteresisC = Number(policy.hysteresisC ?? config.telemetry.tempHysteresisC);

  // DS18B20 power-on reset (85.0C) or disconnected (-127.0C) or invalid physical bounds
  const isInvalidNumber =
    temperatureC === null ||
    temperatureC === undefined ||
    !Number.isFinite(Number(temperatureC));
  const numTemp = Number(temperatureC);
  const isKnownFaultReading =
    sensorErrorFlag ||
    isInvalidNumber ||
    numTemp <= -100 ||
    numTemp === 85 ||
    numTemp > 125;

  if (isKnownFaultReading) {
    return {
      qualityStatus: "sensor_error",
      excursionType: "sensor_failure",
      peltierCommand: "OFF", // fail-safe off on sensor fault
      coolingActive: false,
      alertSeverity: "critical",
      reason: "Temperature sensor returned invalid/fault reading."
    };
  }

  // Hysteresis bands inside/around [minC, maxC]
  const coolOnThreshold = maxC - hysteresisC; // e.g., 7.5C
  const coolOffThreshold = minC + hysteresisC; // e.g., 4.5C

  if (numTemp > maxC) {
    return {
      qualityStatus: "critical",
      excursionType: "high",
      thresholdC: maxC,
      peltierCommand: "ON",
      coolingActive: true,
      alertSeverity: "critical",
      reason: `Chamber temperature ${numTemp.toFixed(2)}°C exceeded upper limit (${maxC}°C).`
    };
  }

  if (numTemp < minC) {
    return {
      qualityStatus: "critical",
      excursionType: "low",
      thresholdC: minC,
      peltierCommand: "OFF",
      coolingActive: false,
      alertSeverity: "critical",
      reason: `Chamber temperature ${numTemp.toFixed(2)}°C dropped below lower limit (${minC}°C).`
    };
  }

  // Within [minC, maxC]: apply hysteresis to prevent rapid relay/Peltier chatter
  let nextCooling = currentlyCooling;
  let command = "HOLD";
  if (numTemp >= coolOnThreshold && !currentlyCooling) {
    nextCooling = true;
    command = "ON";
  } else if (numTemp <= coolOffThreshold && currentlyCooling) {
    nextCooling = false;
    command = "OFF";
  }

  const nearBoundary = numTemp >= coolOnThreshold || numTemp <= coolOffThreshold;
  return {
    qualityStatus: nearBoundary ? "warning" : "ok",
    excursionType: null,
    thresholdC: null,
    peltierCommand: command,
    coolingActive: nextCooling,
    alertSeverity: null,
    reason: `Temperature ${numTemp.toFixed(2)}°C within target range (${minC}°C - ${maxC}°C).`
  };
}
