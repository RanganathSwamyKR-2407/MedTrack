import express from "express";
import { z } from "zod";
import { validateBody } from "../../middleware/validate.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { computeDeviceConnectivity, syncDeviceOfflineAlerts } from "../devices/devices.routes.js";
import { recordAudit } from "../../utils/audit.js";
import { notificationService } from "../../services/notificationService.js";
import { config } from "../../config/env.js";
import { parsePositiveIntId } from "../../utils/ownership.js";

const verifyFacilitySchema = z.object({
  status: z.enum(["approved", "rejected", "pending"])
});

const updateUserRoleSchema = z.object({
  role: z.enum(["patient", "hospital", "blood_bank", "admin"]),
  status: z.enum(["active", "suspended"]).optional()
});

export function createAdminRouter(db) {
  const router = express.Router();

  router.use(requireAuth, requireRole("admin"));

  router.get("/overview", (_req, res) => {
    syncDeviceOfflineAlerts(db);
    const hospitals = db.queryAll("SELECT * FROM hospitals ORDER BY id DESC");
    const bloodBanks = db.queryAll("SELECT * FROM blood_banks ORDER BY id DESC");
    const devices = db.queryAll("SELECT * FROM devices ORDER BY id DESC").map((d) => ({
      ...d,
      connectivity: d.status === "maintenance" ? "maintenance" : computeDeviceConnectivity(d.last_seen_at),
      sensors: db.queryAll("SELECT * FROM device_sensors WHERE device_id = ? ORDER BY id ASC", [d.id])
    }));
    const activeTransports = db.queryAll(
      `SELECT t.*, br.blood_group, br.units_requested, d.device_uid, h.name AS hospital_name, bb.name AS bank_name
       FROM transports t
       JOIN blood_requests br ON br.id = t.blood_request_id
       JOIN devices d ON d.id = t.device_id
       LEFT JOIN hospitals h ON h.id = t.destination_hospital_id
       JOIN blood_banks bb ON bb.id = t.origin_blood_bank_id
       ORDER BY t.id DESC LIMIT 30`
    );
    const inventorySummary = db.queryAll(
      `SELECT blood_group, SUM(units_available) AS total_units
       FROM blood_inventory GROUP BY blood_group ORDER BY blood_group ASC`
    );
    const excursions = db.queryAll(
      `SELECT te.*, d.device_uid FROM temperature_excursions te
       JOIN devices d ON d.id = te.device_id
       ORDER BY te.id DESC LIMIT 30`
    );
    const accessLogs = db.queryAll(
      `SELECT al.*, d.device_uid FROM access_logs al
       JOIN devices d ON d.id = al.device_id
       ORDER BY al.id DESC LIMIT 40`
    );

    res.json({
      hospitals,
      bloodBanks,
      devices,
      activeTransports,
      inventorySummary,
      excursions,
      accessLogs
    });
  });

  router.patch("/facilities/:type/:id/verify", validateBody(verifyFacilitySchema), (req, res) => {
    const { type, id } = req.params;
    const numericId = parsePositiveIntId(id);
    if (!numericId) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid facility ID required." } });
    }
    const table = type === "hospital" ? "hospitals" : type === "blood_bank" ? "blood_banks" : null;
    if (!table) {
      return res.status(400).json({ error: { code: "INVALID_TYPE", message: "Facility type must be hospital or blood_bank." } });
    }

    const row = db.queryOne(`SELECT * FROM ${table} WHERE id = ?`, [numericId]);
    if (!row) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Facility not found." } });
    }

    db.execute(
      `UPDATE ${table} SET verification_status = ?, verified_by = ?, verified_at = datetime('now') WHERE id = ?`,
      [req.validatedBody.status, req.user.id, numericId]
    );

    notificationService.createAlert(db, {
      targetRole: type === "hospital" ? "hospital" : "blood_bank",
      targetHospitalId: type === "hospital" ? numericId : null,
      targetBloodBankId: type === "blood_bank" ? numericId : null,
      severity: req.validatedBody.status === "approved" ? "info" : "warning",
      category: "verification",
      title: `Facility Verification ${req.validatedBody.status.toUpperCase()}`,
      message: `${row.name} verification status updated to ${req.validatedBody.status}.`
    });

    recordAudit(db, {
      actorUserId: req.user.id,
      actorRole: req.user.role,
      action: `${type}.verification_updated`,
      entityType: type,
      entityId: numericId,
      metadata: { status: req.validatedBody.status },
      ipAddress: req.ip
    });

    res.json({ facility: db.queryOne(`SELECT * FROM ${table} WHERE id = ?`, [numericId]) });
  });

  router.get("/users", (_req, res) => {
    const users = db.queryAll(
      "SELECT id, first_name, last_name, email, phone, role, email_verified, phone_verified, status, created_at FROM users ORDER BY id DESC"
    );
    res.json({ users });
  });

  router.patch("/users/:id/role", validateBody(updateUserRoleSchema), (req, res) => {
    const id = parsePositiveIntId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid user ID required." } });
    }
    const user = db.queryOne("SELECT id FROM users WHERE id = ?", [id]);
    if (!user) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found." } });
    }
    db.execute(
      "UPDATE users SET role = ?, status = COALESCE(?, status), updated_at = datetime('now') WHERE id = ?",
      [req.validatedBody.role, req.validatedBody.status ?? null, id]
    );
    recordAudit(db, {
      actorUserId: req.user.id,
      actorRole: req.user.role,
      action: "user.role_updated",
      entityType: "user",
      entityId: id,
      metadata: req.validatedBody,
      ipAddress: req.ip
    });
    res.json({
      user: db.queryOne(
        "SELECT id, first_name, last_name, email, phone, role, status FROM users WHERE id = ?",
        [id]
      )
    });
  });

  router.get("/health", (_req, res) => {
    const devices = db.queryAll("SELECT * FROM devices");
    const onlineCount = devices.filter((d) => computeDeviceConnectivity(d.last_seen_at) === "online").length;
    const openExcursions = db.queryOne("SELECT COUNT(*) AS count FROM temperature_excursions WHERE resolved_at IS NULL")?.count || 0;
    const pendingHospitals = db.queryOne("SELECT COUNT(*) AS count FROM hospitals WHERE verification_status = 'pending'")?.count || 0;
    const pendingBanks = db.queryOne("SELECT COUNT(*) AS count FROM blood_banks WHERE verification_status = 'pending'")?.count || 0;

    res.json({
      status: "healthy",
      databaseDriver: config.db.driver,
      simulationMode: config.simulationMode,
      uptimeSeconds: Math.round(process.uptime()),
      devicesTotal: devices.length,
      devicesOnline: onlineCount,
      openTemperatureExcursions: Number(openExcursions),
      pendingVerifications: Number(pendingHospitals) + Number(pendingBanks)
    });
  });

  router.get("/audit-logs", (_req, res) => {
    const logs = db.queryAll(
      `SELECT al.*, u.email AS actor_email
       FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_user_id
       ORDER BY al.id DESC LIMIT 100`
    );
    res.json({ logs });
  });

  return router;
}
