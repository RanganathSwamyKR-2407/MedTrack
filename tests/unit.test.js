import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateTemperaturePolicy } from "../backend/modules/telemetry/temperaturePolicy.js";
import { computeStockStatus } from "../backend/db/seed.js";
import { haversineDistanceKm } from "../backend/utils/geo.js";
import { generateSecureOtp, hashOtpSecret, timingSafeHexCompare } from "../backend/modules/otp-access/otpService.js";
import { parseUtcMs, ageSecondsFromNow } from "../backend/utils/time.js";
import { parsePositiveIntId } from "../backend/utils/ownership.js";

describe("Temperature Policy & Hysteresis", () => {
  it("keeps HOLD within 4-8C hysteresis band", () => {
    const res = evaluateTemperaturePolicy({
      temperatureC: 6.0,
      currentlyCooling: false,
      policy: { targetMinC: 4.0, targetMaxC: 8.0, hysteresisC: 0.5 }
    });
    assert.equal(res.qualityStatus, "ok");
    assert.equal(res.excursionType, null);
    assert.equal(res.peltierCommand, "HOLD");
  });

  it("activates cooling near upper hysteresis bound and stops near lower bound", () => {
    const turnOn = evaluateTemperaturePolicy({
      temperatureC: 7.7,
      currentlyCooling: false,
      policy: { targetMinC: 4.0, targetMaxC: 8.0, hysteresisC: 0.5 }
    });
    assert.equal(turnOn.peltierCommand, "ON");
    assert.equal(turnOn.coolingActive, true);
    assert.equal(turnOn.qualityStatus, "warning");

    const turnOff = evaluateTemperaturePolicy({
      temperatureC: 4.3,
      currentlyCooling: true,
      policy: { targetMinC: 4.0, targetMaxC: 8.0, hysteresisC: 0.5 }
    });
    assert.equal(turnOff.peltierCommand, "OFF");
    assert.equal(turnOff.coolingActive, false);
  });

  it("triggers high excursion and cooling ON above 8C", () => {
    const res = evaluateTemperaturePolicy({ temperatureC: 8.7, currentlyCooling: false });
    assert.equal(res.qualityStatus, "critical");
    assert.equal(res.excursionType, "high");
    assert.equal(res.peltierCommand, "ON");
    assert.equal(res.coolingActive, true);
  });

  it("triggers low excursion and cooling OFF below 4C", () => {
    const res = evaluateTemperaturePolicy({ temperatureC: 3.4, currentlyCooling: true });
    assert.equal(res.qualityStatus, "critical");
    assert.equal(res.excursionType, "low");
    assert.equal(res.peltierCommand, "OFF");
    assert.equal(res.coolingActive, false);
  });

  it("detects DS18B20 sensor disconnect (-127C), power-on reset (85C), and explicit sensorError", () => {
    const disc = evaluateTemperaturePolicy({ temperatureC: -127, currentlyCooling: true });
    assert.equal(disc.qualityStatus, "sensor_error");
    assert.equal(disc.excursionType, "sensor_failure");
    assert.equal(disc.peltierCommand, "OFF");

    const reset = evaluateTemperaturePolicy({ temperatureC: 85 });
    assert.equal(reset.excursionType, "sensor_failure");

    const explicit = evaluateTemperaturePolicy({ sensorError: true, currentlyCooling: true });
    assert.equal(explicit.qualityStatus, "sensor_error");
    assert.equal(explicit.peltierCommand, "OFF");
  });
});

describe("Blood Inventory Stock Status", () => {
  it("classifies Sufficient, Low, Critical, and Unavailable with default and custom thresholds", () => {
    assert.equal(computeStockStatus(12), "Sufficient");
    assert.equal(computeStockStatus(6), "Low");
    assert.equal(computeStockStatus(2), "Critical");
    assert.equal(computeStockStatus(0), "Unavailable");
    assert.equal(computeStockStatus(15, 10, 4), "Sufficient");
    assert.equal(computeStockStatus(9, 10, 4), "Low");
    assert.equal(computeStockStatus(3, 10, 4), "Critical");
  });
});

describe("Geospatial Distance & OTP Security Helpers", () => {
  it("computes realistic Haversine distance between Pune and Mumbai", () => {
    const km = haversineDistanceKm(18.5204, 73.8567, 19.0760, 72.8777);
    assert.ok(km > 110 && km < 135, `Expected ~120 km, got ${km}`);
  });

  it("generates 6-digit OTPs and verifies HMAC digests securely", () => {
    const otp = generateSecureOtp();
    assert.match(otp, /^[0-9]{6}$/);
    const hash = hashOtpSecret(otp);
    assert.notEqual(hash, otp);
    assert.equal(timingSafeHexCompare(hash, hashOtpSecret(otp)), true);
    assert.equal(timingSafeHexCompare(hash, hashOtpSecret("000000")), false);
  });
});

describe("UTC Time & ID Validation Helpers", () => {
  it("parses SQLite UTC datetime strings accurately without timezone drift", () => {
    const sqliteNow = new Date().toISOString().slice(0, 19).replace("T", " ");
    const ms = parseUtcMs(sqliteNow);
    assert.ok(Number.isFinite(ms));
    const age = ageSecondsFromNow(sqliteNow);
    assert.ok(age >= -1 && age < 5, `Expected ~0s age, got ${age}`);
  });

  it("validates positive integer IDs strictly", () => {
    assert.equal(parsePositiveIntId("42"), 42);
    assert.equal(parsePositiveIntId(1), 1);
    assert.equal(parsePositiveIntId("0"), null);
    assert.equal(parsePositiveIntId("-5"), null);
    assert.equal(parsePositiveIntId("abc"), null);
    assert.equal(parsePositiveIntId("1.5"), null);
  });
});
