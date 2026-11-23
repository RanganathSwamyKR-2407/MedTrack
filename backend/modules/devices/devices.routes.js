import express from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { validateBody } from "../../middleware/validate.js";
import { requireAuth, requireRole, requireDeviceAuth } from "../../middleware/auth.js";
import { hashApiKey } from "../../db/seed.js";
import { config } from "../../config/env.js";
import { recordAudit } from "../../utils/audit.js";
import { ageSecondsFromNow } from "../../utils/time.js";
import { parsePositiveIntId } from "../../utils/ownership.js";

const registerDeviceSchema = z.object({
  deviceUid: z.string().min(4).max(64),
  name: z.string().min(2).max(120),
  hardwareModel: z.string().min(2).max(80).default("ESP32-WROOM-32"),
  firmwareVersion: z.string().default("1.0.0"),
  capabilities: z.array(z.string()).default(["temperature", "gps", "reed_switch", "peltier_relay", "servo_latch"]),
  sensors: z
    .array(
      z.object({
        sensorType: z.string().min(2).max(50),
        label: z.string().min(2).max(120),
        unit: z.string().min(1).max(20),
        minThreshold: z.number().nullable().optional(),
        maxThreshold: z.number().nullable().optional()
      })
    )
    .optional()
});

const deviceConfigSchema = z.object({
  targetMinC: z.number().min(-20).max(25).optional(),
  targetMaxC: z.number().min(-15).max(30).optional(),
  hysteresisC: z.number().min(0.1).max(5.0).optional(),
  minSwitchIntervalSec: z.number().int().min(5).max(600).optional(),
  status: z.enum(["online", "offline", "maintenance"]).optional()
});

export function computeDeviceConnectivity(lastSeenAt) {
  if (!lastSeenAt) return "offline";
  const ageSec = ageSecondsFromNow(lastSeenAt);
  if (!Number.isFinite(ageSec) || ageSec > config.telemetry.deviceOfflineSeconds) return "offline";
  if (ageSec > config.telemetry.tempStaleSeconds) return "stale";
  return "online";
}

const addSensorSchema = z.object({
  sensorType: z.string().min(2).max(50),
  label: z.string().min(2).max(120),
  unit: z.string().min(1).max(20),
  minThreshold: z.number().nullable().optional(),
  maxThreshold: z.number().nullable().optional()
});

/**
 * Checks non-maintenance devices whose last_seen_at exceeded deviceOfflineSeconds
 * and ensures a device_offline alert is generated once per disconnection period.
 */
export function syncDeviceOfflineAlerts(db) {
  if (!db) return [];
  const createdAlerts = [];
  const devices = db.queryAll("SELECT * FROM devices WHERE status != 'maintenance' AND last_seen_at IS NOT NULL");
  for (const d of devices) {
    const conn = computeDeviceConnectivity(d.last_seen_at);
    if (conn !== "offline") continue;

    if (d.status === "online") {
      db.execute("UPDATE devices SET status = 'offline' WHERE id = ?", [d.id]);
    }

    const activeTransport = db.queryOne(
      "SELECT id, transport_code, destination_hospital_id, origin_blood_bank_id FROM transports WHERE device_id = ? AND status IN ('assigned', 'in_transit', 'arrived') ORDER BY id DESC LIMIT 1",
      [d.id]
    );

    const existingAlert = db.queryOne(
      `SELECT id FROM alerts
       WHERE device_id = ? AND category = 'device_offline'
         AND acknowledged_at IS NULL
         AND datetime(created_at) >= datetime(?)
       LIMIT 1`,
      [d.id, d.last_seen_at]
    );

    if (!existingAlert) {
      const severity = activeTransport ? "critical" : "warning";
      const res = db.execute(
        `INSERT INTO alerts (
          target_role, target_hospital_id, target_blood_bank_id, device_id, transport_id,
          severity, category, title, message
        ) VALUES (?, ?, ?, ?, ?, ?, 'device_offline', ?, ?)`,
        [
          activeTransport ? "hospital" : "admin",
          activeTransport?.destination_hospital_id || null,
          activeTransport?.origin_blood_bank_id || null,
          d.id,
          activeTransport?.id || null,
          severity,
          `Device Disconnected: ${d.device_uid}`,
          `Transport box ${d.device_uid} (${d.name}) stopped reporting telemetry (last seen ${d.last_seen_at} UTC).`
        ]
      );
      createdAlerts.push(res.lastInsertRowid);
    }
  }
  return createdAlerts;
}

export function createDevicesRouter(db) {
  const router = express.Router();

  router.post("/register", requireAuth, requireRole("admin", "blood_bank"), validateBody(registerDeviceSchema), (req, res) => {
    const d = req.validatedBody;
    const dup = db.queryOne("SELECT id FROM devices WHERE device_uid = ?", [d.deviceUid.trim()]);
    if (dup) {
      return res.status(409).json({
        error: { code: "DUPLICATE_DEVICE", message: "Device UID already exists." }
      });
    }

    const rawApiKey = `mtk_${crypto.randomBytes(24).toString("hex")}`;
    const apiKeyHash = hashApiKey(rawApiKey);

    const coolingPolicy = {
      targetMinC: config.telemetry.tempMinC,
      targetMaxC: config.telemetry.tempMaxC,
      hysteresisC: config.telemetry.tempHysteresisC,
      minSwitchIntervalSec: 30
    };

    const device = db.transaction(() => {
      const insert = db.execute(
        `INSERT INTO devices (device_uid, name, hardware_model, api_key_hash, capabilities_json, cooling_policy_json, firmware_version, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'offline')`,
        [
          d.deviceUid.trim(),
          d.name.trim(),
          d.hardwareModel.trim(),
          apiKeyHash,
          JSON.stringify(d.capabilities),
          JSON.stringify(coolingPolicy),
          d.firmwareVersion
        ]
      );

      const sensors = d.sensors || [
        { sensorType: "temperature", label: "Internal Temperature", unit: "°C", minThreshold: 4.0, maxThreshold: 8.0 },
        { sensorType: "gps", label: "GPS Neo-6M", unit: "deg", minThreshold: null, maxThreshold: null },
        { sensorType: "reed_switch", label: "Door Reed Switch", unit: "state", minThreshold: null, maxThreshold: null }
      ];
      for (const s of sensors) {
        db.execute(
          `INSERT INTO device_sensors (device_id, sensor_type, label, unit, min_threshold, max_threshold)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [insert.lastInsertRowid, s.sensorType, s.label, s.unit, s.minThreshold ?? null, s.maxThreshold ?? null]
        );
      }

      recordAudit(db, {
        actorUserId: req.user.id,
        actorRole: req.user.role,
        action: "device.registered",
        entityType: "device",
        entityId: insert.lastInsertRowid,
        metadata: { deviceUid: d.deviceUid },
        ipAddress: req.ip
      });

      return db.queryOne("SELECT * FROM devices WHERE id = ?", [insert.lastInsertRowid]);
    });

    res.status(201).json({
      device: {
        id: device.id,
        deviceUid: device.device_uid,
        name: device.name,
        hardwareModel: device.hardware_model,
        capabilities: JSON.parse(device.capabilities_json),
        coolingPolicy: JSON.parse(device.cooling_policy_json)
      },
      // Shown once upon provisioning so the firmware config.h can be flashed securely
      deviceApiKey: rawApiKey
    });
  });

  router.get("/", requireAuth, (_req, res) => {
    syncDeviceOfflineAlerts(db);
    const rows = db.queryAll("SELECT * FROM devices ORDER BY id ASC");
    const devices = rows.map((d) => {
      const sensors = db.queryAll("SELECT * FROM device_sensors WHERE device_id = ?", [d.id]);
      const activeTransport = db.queryOne(
        "SELECT id, transport_code FROM transports WHERE device_id = ? AND status IN ('assigned', 'in_transit', 'arrived') ORDER BY id DESC LIMIT 1",
        [d.id]
      );
      const latestTemp = db.queryOne(
        `SELECT value_numeric, quality_status, cooling_active, is_simulated, recorded_at
         FROM sensor_readings WHERE device_id = ? AND sensor_type = 'temperature'
         ORDER BY id DESC LIMIT 1`,
        [d.id]
      );
      const latestGps = db.queryOne(
        `SELECT latitude, longitude, speed_kmh, fix_valid, is_simulated, recorded_at
         FROM gps_locations WHERE device_id = ? ORDER BY id DESC LIMIT 1`,
        [d.id]
      );
      return {
        id: d.id,
        deviceUid: d.device_uid,
        name: d.name,
        hardwareModel: d.hardware_model,
        firmwareVersion: d.firmware_version,
        capabilities: JSON.parse(d.capabilities_json || "[]"),
        coolingPolicy: JSON.parse(d.cooling_policy_json || "{}"),
        status: d.status,
        connectivity: d.status === "maintenance" ? "maintenance" : computeDeviceConnectivity(d.last_seen_at),
        inUse: Boolean(activeTransport),
        activeTransportId: activeTransport ? activeTransport.id : null,
        activeTransportCode: activeTransport ? activeTransport.transport_code : null,
        lastSeenAt: d.last_seen_at,
        sensors,
        latestTemperature: latestTemp,
        latestGps
      };
    });
    res.json({ devices });
  });

  router.get("/:id", requireAuth, (req, res) => {
    const id = parsePositiveIntId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid device ID required." } });
    }
    syncDeviceOfflineAlerts(db);
    const d = db.queryOne("SELECT * FROM devices WHERE id = ?", [id]);
    if (!d) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Device not found." } });
    }
    const sensors = db.queryAll("SELECT * FROM device_sensors WHERE device_id = ?", [d.id]);
    res.json({
      device: {
        id: d.id,
        deviceUid: d.device_uid,
        name: d.name,
        hardwareModel: d.hardware_model,
        firmwareVersion: d.firmware_version,
        capabilities: JSON.parse(d.capabilities_json || "[]"),
        coolingPolicy: JSON.parse(d.cooling_policy_json || "{}"),
        status: d.status,
        connectivity: d.status === "maintenance" ? "maintenance" : computeDeviceConnectivity(d.last_seen_at),
        lastSeenAt: d.last_seen_at,
        sensors
      }
    });
  });

  router.post("/:id/sensors", requireAuth, requireRole("admin", "blood_bank"), validateBody(addSensorSchema), (req, res) => {
    const id = parsePositiveIntId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid device ID required." } });
    }
    const d = db.queryOne("SELECT * FROM devices WHERE id = ?", [id]);
    if (!d) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Device not found." } });
    }
    const s = req.validatedBody;
    const sensorType = s.sensorType.trim().toLowerCase();
    const existing = db.queryOne("SELECT id FROM device_sensors WHERE device_id = ? AND sensor_type = ?", [id, sensorType]);
    if (existing) {
      db.execute(
        `UPDATE device_sensors SET label = ?, unit = ?, min_threshold = ?, max_threshold = ?, status = 'active'
         WHERE id = ?`,
        [s.label.trim(), s.unit.trim(), s.minThreshold ?? null, s.maxThreshold ?? null, existing.id]
      );
    } else {
      db.execute(
        `INSERT INTO device_sensors (device_id, sensor_type, label, unit, min_threshold, max_threshold)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, sensorType, s.label.trim(), s.unit.trim(), s.minThreshold ?? null, s.maxThreshold ?? null]
      );
      const caps = JSON.parse(d.capabilities_json || "[]");
      if (!caps.includes(sensorType)) {
        caps.push(sensorType);
        db.execute("UPDATE devices SET capabilities_json = ? WHERE id = ?", [JSON.stringify(caps), id]);
      }
    }
    const sensors = db.queryAll("SELECT * FROM device_sensors WHERE device_id = ?", [id]);
    res.status(201).json({ deviceId: id, sensors });
  });

  router.patch("/:id/config", requireAuth, requireRole("admin", "blood_bank"), validateBody(deviceConfigSchema), (req, res) => {
    const id = parsePositiveIntId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid device ID required." } });
    }
    const d = db.queryOne("SELECT * FROM devices WHERE id = ?", [id]);
    if (!d) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Device not found." } });
    }
    const currentPolicy = JSON.parse(d.cooling_policy_json || "{}");
    const nextPolicy = {
      targetMinC: config.telemetry.tempMinC,
      targetMaxC: config.telemetry.tempMaxC,
      hysteresisC: config.telemetry.tempHysteresisC,
      minSwitchIntervalSec: 30,
      ...currentPolicy,
      ...(req.validatedBody.targetMinC !== undefined ? { targetMinC: req.validatedBody.targetMinC } : {}),
      ...(req.validatedBody.targetMaxC !== undefined ? { targetMaxC: req.validatedBody.targetMaxC } : {}),
      ...(req.validatedBody.hysteresisC !== undefined ? { hysteresisC: req.validatedBody.hysteresisC } : {}),
      ...(req.validatedBody.minSwitchIntervalSec !== undefined
        ? { minSwitchIntervalSec: req.validatedBody.minSwitchIntervalSec }
        : {})
    };

    if (nextPolicy.targetMinC >= nextPolicy.targetMaxC) {
      return res.status(400).json({
        error: { code: "INVALID_THRESHOLDS", message: "targetMinC must be strictly lower than targetMaxC." }
      });
    }
    if (nextPolicy.hysteresisC * 2 >= nextPolicy.targetMaxC - nextPolicy.targetMinC) {
      return res.status(400).json({
        error: {
          code: "INVALID_HYSTERESIS",
          message: "hysteresisC must be less than half of (targetMaxC - targetMinC)."
        }
      });
    }

    db.execute(
      "UPDATE devices SET cooling_policy_json = ?, status = COALESCE(?, status) WHERE id = ?",
      [JSON.stringify(nextPolicy), req.validatedBody.status ?? null, id]
    );
    db.execute(
      `UPDATE device_sensors SET min_threshold = ?, max_threshold = ?
       WHERE device_id = ? AND sensor_type = 'temperature'`,
      [nextPolicy.targetMinC, nextPolicy.targetMaxC, id]
    );

    res.json({ deviceId: id, coolingPolicy: nextPolicy });
  });

  // Device-UID authenticated heartbeat (for ESP32 firmware without hardcoding numeric DB IDs)
  router.post("/heartbeat", requireDeviceAuth(db), (req, res) => {
    db.execute("UPDATE devices SET status = 'online', last_seen_at = datetime('now') WHERE id = ?", [req.device.id]);
    res.json({
      ok: true,
      deviceId: req.device.id,
      deviceUid: req.device.device_uid,
      serverTime: new Date().toISOString(),
      coolingPolicy: JSON.parse(req.device.cooling_policy_json || "{}")
    });
  });

  router.post("/:id/heartbeat", requireDeviceAuth(db), (req, res) => {
    if (req.device.id !== Number(req.params.id)) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Device ID mismatch." } });
    }
    db.execute("UPDATE devices SET status = 'online', last_seen_at = datetime('now') WHERE id = ?", [req.device.id]);
    res.json({
      ok: true,
      serverTime: new Date().toISOString(),
      coolingPolicy: JSON.parse(req.device.cooling_policy_json || "{}")
    });
  });

  return router;
}
