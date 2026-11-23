import express from "express";
import { z } from "zod";
import { validateBody } from "../../middleware/validate.js";
import { requireAuth, requireRole, requireDeviceAuth } from "../../middleware/auth.js";
import { config } from "../../config/env.js";
import { evaluateTemperaturePolicy } from "./temperaturePolicy.js";
import { notificationService } from "../../services/notificationService.js";
import { computeDeviceConnectivity } from "../devices/devices.routes.js";
import { canAccessDevice, canAccessTransport, parsePositiveIntId } from "../../utils/ownership.js";
import { ageSecondsFromNow } from "../../utils/time.js";

const genericSensorReadingSchema = z.object({
  sensorType: z.string().min(2).max(50),
  valueNumeric: z.number().nullable().optional(),
  valueJson: z.record(z.unknown()).optional(),
  unit: z.string().min(1).max(20).optional(),
  sensorError: z.boolean().optional(),
  currentlyCooling: z.boolean().optional(),
  transportId: z.number().int().positive().optional(),
  recordedAt: z.string().optional()
});

const gpsUpdateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speedKmh: z.number().min(0).max(300).optional(),
  satellites: z.number().int().min(0).max(50).optional(),
  hdop: z.number().min(0).max(99).optional(),
  fixValid: z.boolean().default(true),
  transportId: z.number().int().positive().optional()
});

const simulateTelemetrySchema = z.object({
  deviceId: z.number().int().positive(),
  transportId: z.number().int().positive().optional(),
  temperatureC: z.number().optional(),
  sensorError: z.boolean().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  speedKmh: z.number().min(0).max(250).optional()
});

function findActiveTransportForDevice(db, deviceId, explicitTransportId = null) {
  if (explicitTransportId) {
    return db.queryOne("SELECT * FROM transports WHERE id = ?", [explicitTransportId]);
  }
  return db.queryOne(
    "SELECT * FROM transports WHERE device_id = ? AND status IN ('assigned', 'in_transit', 'arrived') ORDER BY id DESC LIMIT 1",
    [deviceId]
  );
}

export function processSensorReading(db, {
  device,
  sensorType,
  valueNumeric = null,
  valueJson = null,
  unit = null,
  sensorError = false,
  currentlyCooling = false,
  transportId = null,
  isSimulated = false
}) {
  const activeTransport = findActiveTransportForDevice(db, device.id, transportId);
  const resolvedTransportId = activeTransport ? activeTransport.id : null;
  const policy = JSON.parse(device.cooling_policy_json || "{}");

  db.execute("UPDATE devices SET status = 'online', last_seen_at = datetime('now') WHERE id = ?", [device.id]);

  if (sensorType === "temperature") {
    const evaluation = evaluateTemperaturePolicy({
      temperatureC: valueNumeric,
      sensorErrorFlag: sensorError,
      currentlyCooling,
      policy
    });

    const readingRes = db.execute(
      `INSERT INTO sensor_readings (
        device_id, transport_id, sensor_type, value_numeric, unit, quality_status, cooling_active, is_simulated
      ) VALUES (?, ?, 'temperature', ?, ?, ?, ?, ?)`,
      [
        device.id,
        resolvedTransportId,
        valueNumeric,
        unit || "°C",
        evaluation.qualityStatus,
        evaluation.coolingActive ? 1 : 0,
        isSimulated ? 1 : 0
      ]
    );

    // Track excursion lifecycle
    const openExcursion = db.queryOne(
      "SELECT * FROM temperature_excursions WHERE device_id = ? AND resolved_at IS NULL ORDER BY id DESC LIMIT 1",
      [device.id]
    );

    if (evaluation.excursionType) {
      if (!openExcursion || openExcursion.excursion_type !== evaluation.excursionType) {
        if (openExcursion) {
          db.execute("UPDATE temperature_excursions SET resolved_at = datetime('now') WHERE id = ?", [openExcursion.id]);
        }
        db.execute(
          `INSERT INTO temperature_excursions (device_id, transport_id, excursion_type, threshold_c, observed_value_c, notes)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            device.id,
            resolvedTransportId,
            evaluation.excursionType,
            evaluation.thresholdC ?? null,
            valueNumeric ?? null,
            evaluation.reason
          ]
        );

        notificationService.createAlert(db, {
          targetRole: "hospital",
          targetHospitalId: activeTransport?.destination_hospital_id || null,
          targetBloodBankId: activeTransport?.origin_blood_bank_id || null,
          deviceId: device.id,
          transportId: resolvedTransportId,
          severity: "critical",
          category: "temperature",
          title:
            evaluation.excursionType === "sensor_failure"
              ? `Sensor Failure on ${device.device_uid}`
              : `Temperature Excursion (${evaluation.excursionType.toUpperCase()}) on ${device.device_uid}`,
          message: evaluation.reason
        });
      }
    } else if (openExcursion) {
      db.execute("UPDATE temperature_excursions SET resolved_at = datetime('now') WHERE id = ?", [openExcursion.id]);
      notificationService.createAlert(db, {
        targetRole: "hospital",
        targetHospitalId: activeTransport?.destination_hospital_id || null,
        deviceId: device.id,
        transportId: resolvedTransportId,
        severity: "info",
        category: "temperature",
        title: `Temperature Normalized on ${device.device_uid}`,
        message: evaluation.reason
      });
    }

    return {
      readingId: readingRes.lastInsertRowid,
      sensorType: "temperature",
      evaluation,
      coolingPolicy: policy
    };
  }

  // Generic extensible sensor ingestion (humidity, shock/MPU6050, load-cell weight, battery, gas, etc.)
  const registeredSensor = db.queryOne(
    "SELECT * FROM device_sensors WHERE device_id = ? AND sensor_type = ?",
    [device.id, sensorType]
  );
  let qualityStatus = sensorError ? "sensor_error" : "ok";
  if (
    !sensorError &&
    registeredSensor &&
    valueNumeric !== null &&
    ((registeredSensor.min_threshold !== null && valueNumeric < registeredSensor.min_threshold) ||
      (registeredSensor.max_threshold !== null && valueNumeric > registeredSensor.max_threshold))
  ) {
    qualityStatus = "warning";
  }

  const insert = db.execute(
    `INSERT INTO sensor_readings (
      device_id, transport_id, sensor_type, value_numeric, value_json, unit, quality_status, is_simulated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      device.id,
      resolvedTransportId,
      sensorType,
      valueNumeric,
      valueJson ? JSON.stringify(valueJson) : null,
      unit || registeredSensor?.unit || "unit",
      qualityStatus,
      isSimulated ? 1 : 0
    ]
  );

  return { readingId: insert.lastInsertRowid, sensorType, qualityStatus };
}

export function createSensorsRouter(db) {
  const router = express.Router();

  router.post("/readings", requireDeviceAuth(db), validateBody(genericSensorReadingSchema), (req, res) => {
    const d = req.validatedBody;
    const outcome = processSensorReading(db, {
      device: req.device,
      sensorType: d.sensorType,
      valueNumeric: d.valueNumeric ?? null,
      valueJson: d.valueJson ?? null,
      unit: d.unit ?? null,
      sensorError: Boolean(d.sensorError),
      currentlyCooling: Boolean(d.currentlyCooling),
      transportId: d.transportId ?? null,
      isSimulated: false
    });
    res.status(201).json(outcome);
  });

  // Explicitly labeled development/testing simulator endpoint
  router.post(
    "/simulate",
    requireAuth,
    requireRole("hospital", "blood_bank", "admin"),
    validateBody(simulateTelemetrySchema),
    (req, res) => {
      if (!config.simulationMode) {
        return res.status(403).json({
          error: { code: "SIMULATION_DISABLED", message: "Simulation mode is disabled in production." }
        });
      }
      const d = req.validatedBody;
      const device = db.queryOne("SELECT * FROM devices WHERE id = ?", [d.deviceId]);
      if (!device) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Device not found." } });
      }
      if (!canAccessDevice(db, req.user, device.id)) {
        return res.status(403).json({
          error: { code: "FORBIDDEN", message: "Access denied to simulate telemetry on this device." }
        });
      }

      const result = {};
      if (d.temperatureC !== undefined || d.sensorError) {
        result.temperature = processSensorReading(db, {
          device,
          sensorType: "temperature",
          valueNumeric: d.temperatureC ?? null,
          sensorError: Boolean(d.sensorError),
          transportId: d.transportId ?? null,
          isSimulated: true
        });
      }

      if (d.latitude !== undefined && d.longitude !== undefined) {
        const activeTransport = findActiveTransportForDevice(db, device.id, d.transportId ?? null);
        db.execute("UPDATE devices SET status = 'online', last_seen_at = datetime('now') WHERE id = ?", [device.id]);
        const gpsRes = db.execute(
          `INSERT INTO gps_locations (device_id, transport_id, latitude, longitude, speed_kmh, satellites, fix_valid, is_simulated)
           VALUES (?, ?, ?, ?, ?, 9, 1, 1)`,
          [device.id, activeTransport ? activeTransport.id : null, d.latitude, d.longitude, d.speedKmh ?? 25]
        );
        result.gps = { locationId: gpsRes.lastInsertRowid, latitude: d.latitude, longitude: d.longitude, simulated: true };
      }

      res.status(201).json({ simulationMode: true, ...result });
    }
  );

  router.get("/:deviceId", requireAuth, (req, res) => {
    const deviceId = parsePositiveIntId(req.params.deviceId);
    if (!deviceId) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid device ID required." } });
    }
    if (!canAccessDevice(db, req.user, deviceId)) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied to device readings." } });
    }
    const sensorType = req.query.sensorType ? String(req.query.sensorType) : null;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

    let sql = "SELECT * FROM sensor_readings WHERE device_id = ?";
    const params = [deviceId];
    if (sensorType) {
      sql += " AND sensor_type = ?";
      params.push(sensorType);
    }
    sql += " ORDER BY id DESC LIMIT ?";
    params.push(limit);

    res.json({ readings: db.queryAll(sql, params) });
  });

  return router;
}

export function createTemperatureRouter(db) {
  const router = express.Router();

  router.get("/:deviceId/history", requireAuth, (req, res) => {
    const deviceId = parsePositiveIntId(req.params.deviceId);
    if (!deviceId) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid device ID required." } });
    }
    const device = db.queryOne("SELECT * FROM devices WHERE id = ?", [deviceId]);
    if (!device) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Device not found." } });
    }
    if (!canAccessDevice(db, req.user, deviceId)) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied to temperature telemetry." } });
    }

    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 40));
    const readings = db
      .queryAll(
        `SELECT id, value_numeric AS temperatureC, quality_status AS qualityStatus,
                cooling_active AS coolingActive, is_simulated AS isSimulated, recorded_at AS recordedAt
         FROM sensor_readings
         WHERE device_id = ? AND sensor_type = 'temperature'
         ORDER BY id DESC LIMIT ?`,
        [deviceId, limit]
      )
      .reverse();

    const latest = readings.length ? readings[readings.length - 1] : null;
    const connectivity = device.status === "maintenance" ? "maintenance" : computeDeviceConnectivity(device.last_seen_at);
    const isStale = latest ? ageSecondsFromNow(latest.recordedAt) > config.telemetry.tempStaleSeconds : true;

    res.json({
      deviceId,
      deviceUid: device.device_uid,
      connectivity,
      isStale,
      coolingPolicy: JSON.parse(device.cooling_policy_json || "{}"),
      latest,
      history: readings,
      clinicalDisclaimer:
        "Prototype monitoring only. Cooling and thermal performance must be physically validated before clinical blood transport."
    });
  });

  router.get("/:deviceId/excursions", requireAuth, (req, res) => {
    const deviceId = parsePositiveIntId(req.params.deviceId);
    if (!deviceId) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid device ID required." } });
    }
    if (!canAccessDevice(db, req.user, deviceId)) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied to excursion logs." } });
    }
    const excursions = db.queryAll(
      "SELECT * FROM temperature_excursions WHERE device_id = ? ORDER BY id DESC LIMIT 50",
      [deviceId]
    );
    res.json({ excursions });
  });

  return router;
}

export function createGpsRouter(db) {
  const router = express.Router();

  router.post("/update", requireDeviceAuth(db), validateBody(gpsUpdateSchema), (req, res) => {
    const d = req.validatedBody;
    const activeTransport = findActiveTransportForDevice(db, req.device.id, d.transportId ?? null);

    db.execute("UPDATE devices SET status = 'online', last_seen_at = datetime('now') WHERE id = ?", [req.device.id]);

    const insert = db.execute(
      `INSERT INTO gps_locations (device_id, transport_id, latitude, longitude, speed_kmh, satellites, hdop, fix_valid, is_simulated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        req.device.id,
        activeTransport ? activeTransport.id : null,
        d.latitude,
        d.longitude,
        d.speedKmh ?? 0,
        d.satellites ?? 0,
        d.hdop ?? 1.0,
        d.fixValid ? 1 : 0
      ]
    );

    if (!d.fixValid) {
      notificationService.createAlert(db, {
        targetRole: "admin",
        deviceId: req.device.id,
        transportId: activeTransport?.id || null,
        severity: "warning",
        category: "gps",
        title: `GPS Fix Lost on ${req.device.device_uid}`,
        message: "Neo-6M GPS module reported invalid fix."
      });
    }

    res.status(201).json({
      locationId: insert.lastInsertRowid,
      transportId: activeTransport?.id || null
    });
  });

  router.get("/:deviceId/latest", requireAuth, (req, res) => {
    const deviceId = parsePositiveIntId(req.params.deviceId);
    if (!deviceId) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid device ID required." } });
    }
    if (!canAccessDevice(db, req.user, deviceId)) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied to device GPS." } });
    }
    const latest = db.queryOne(
      "SELECT * FROM gps_locations WHERE device_id = ? ORDER BY id DESC LIMIT 1",
      [deviceId]
    );
    if (!latest) {
      return res.json({ latest: null, stale: true });
    }
    const ageSec = ageSecondsFromNow(latest.recorded_at);
    res.json({
      latest,
      stale: !Number.isFinite(ageSec) || ageSec > config.telemetry.gpsStaleSeconds,
      ageSeconds: Number.isFinite(ageSec) ? Math.max(0, Math.round(ageSec)) : null
    });
  });

  router.get("/:transportId/route", requireAuth, (req, res) => {
    const transportId = parsePositiveIntId(req.params.transportId);
    if (!transportId) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid transport ID required." } });
    }
    const transport = db.queryOne("SELECT * FROM transports WHERE id = ?", [transportId]);
    if (!transport) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Transport not found." } });
    }
    if (!canAccessTransport(db, req.user, transport)) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied to transport GPS route." } });
    }
    const route = db.queryAll(
      "SELECT * FROM gps_locations WHERE transport_id = ? ORDER BY id ASC",
      [transportId]
    );
    const latest = route.length ? route[route.length - 1] : null;
    const ageSec = latest ? ageSecondsFromNow(latest.recorded_at) : Infinity;
    res.json({
      transportId,
      points: route,
      latest,
      stale: !latest || ageSec > config.telemetry.gpsStaleSeconds
    });
  });

  return router;
}
