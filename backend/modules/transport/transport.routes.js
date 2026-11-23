import express from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { validateBody } from "../../middleware/validate.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { computeStockStatus } from "../../db/seed.js";
import { recordAudit } from "../../utils/audit.js";
import { notificationService } from "../../services/notificationService.js";
import { canAccessTransport, parsePositiveIntId } from "../../utils/ownership.js";

const dispatchSchema = z.object({
  bloodRequestId: z.number().int().positive(),
  deviceId: z.number().int().positive()
});

export function createTransportRouter(db) {
  const router = express.Router();

  router.post("/dispatch", requireAuth, requireRole("blood_bank", "admin"), validateBody(dispatchSchema), (req, res) => {
    const { bloodRequestId, deviceId } = req.validatedBody;

    const reqRow = db.queryOne("SELECT * FROM blood_requests WHERE id = ?", [bloodRequestId]);
    if (!reqRow) {
      return res.status(404).json({ error: { code: "REQUEST_NOT_FOUND", message: "Blood request not found." } });
    }

    const bank = db.queryOne("SELECT * FROM blood_banks WHERE id = ?", [reqRow.blood_bank_id]);
    if (req.user.role !== "admin" && bank.user_id !== req.user.id) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied." } });
    }
    if (reqRow.status !== "accepted") {
      return res.status(409).json({
        error: { code: "INVALID_STATE", message: "Blood request must be accepted before dispatch." }
      });
    }

    const device = db.queryOne("SELECT * FROM devices WHERE id = ?", [deviceId]);
    if (!device) {
      return res.status(404).json({ error: { code: "DEVICE_NOT_FOUND", message: "Transport device not found." } });
    }
    if (device.status === "maintenance") {
      return res.status(409).json({
        error: { code: "DEVICE_MAINTENANCE", message: `Device ${device.device_uid} is currently under maintenance.` }
      });
    }

    const activeOnDevice = db.queryOne(
      "SELECT id FROM transports WHERE device_id = ? AND status IN ('assigned', 'in_transit', 'arrived')",
      [deviceId]
    );
    if (activeOnDevice) {
      return res.status(409).json({
        error: { code: "DEVICE_BUSY", message: `Device ${device.device_uid} is currently assigned to an active transport.` }
      });
    }

    const transport = db.transaction(() => {
      const inv = db.queryOne(
        "SELECT * FROM blood_inventory WHERE blood_bank_id = ? AND blood_group = ?",
        [reqRow.blood_bank_id, reqRow.blood_group]
      );
      if (!inv || inv.units_available < reqRow.units_requested) {
        throw Object.assign(new Error("Insufficient blood inventory available for dispatch."), {
          statusCode: 409,
          code: "INSUFFICIENT_STOCK"
        });
      }

      const newUnits = inv.units_available - reqRow.units_requested;
      const newStatus = computeStockStatus(newUnits, inv.low_threshold, inv.critical_threshold);
      db.execute(
        `UPDATE blood_inventory SET units_available = ?, status = ?, updated_by = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [newUnits, newStatus, req.user.id, inv.id]
      );
      db.execute(
        `INSERT INTO inventory_history (blood_bank_id, blood_group, previous_units, delta_units, new_units, reason, changed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          reqRow.blood_bank_id,
          reqRow.blood_group,
          inv.units_available,
          -reqRow.units_requested,
          newUnits,
          `Dispatched for request ${reqRow.request_code}`,
          req.user.id
        ]
      );

      db.execute(
        "UPDATE blood_requests SET status = 'dispatched', updated_at = datetime('now') WHERE id = ?",
        [reqRow.id]
      );

      const transportCode = `TR-${crypto.randomInt(1000, 9999)}-${Date.now().toString().slice(-3)}`;
      const tRes = db.execute(
        `INSERT INTO transports (
          transport_code, blood_request_id, device_id, origin_blood_bank_id,
          destination_hospital_id, recipient_user_id, recipient_contact, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'in_transit')`,
        [
          transportCode,
          reqRow.id,
          deviceId,
          reqRow.blood_bank_id,
          reqRow.requester_hospital_id,
          reqRow.requester_user_id,
          reqRow.recipient_contact
        ]
      );

      if (reqRow.requester_hospital_id) {
        notificationService.createAlert(db, {
          targetRole: "hospital",
          targetHospitalId: reqRow.requester_hospital_id,
          deviceId,
          transportId: tRes.lastInsertRowid,
          severity: "info",
          category: "transport",
          title: `Shipment ${transportCode} Dispatched`,
          message: `${reqRow.units_requested} unit(s) of ${reqRow.blood_group} dispatched in ${device.device_uid}.`
        });
      }

      recordAudit(db, {
        actorUserId: req.user.id,
        actorRole: req.user.role,
        action: "transport.dispatched",
        entityType: "transport",
        entityId: tRes.lastInsertRowid,
        metadata: { transportCode, deviceUid: device.device_uid },
        ipAddress: req.ip
      });

      return db.queryOne("SELECT * FROM transports WHERE id = ?", [tRes.lastInsertRowid]);
    });

    res.status(201).json({ transport });
  });

  router.get("/", requireAuth, (req, res) => {
    let sql = `
      SELECT
        t.*,
        br.request_code, br.blood_group, br.units_requested, br.urgency,
        bb.name AS origin_bank_name, bb.latitude AS origin_lat, bb.longitude AS origin_lng,
        h.name AS destination_hospital_name, h.latitude AS dest_lat, h.longitude AS dest_lng,
        d.device_uid, d.name AS device_name, d.last_seen_at AS device_last_seen_at
      FROM transports t
      JOIN blood_requests br ON br.id = t.blood_request_id
      JOIN blood_banks bb ON bb.id = t.origin_blood_bank_id
      LEFT JOIN hospitals h ON h.id = t.destination_hospital_id
      JOIN devices d ON d.id = t.device_id
    `;
    const params = [];

    if (req.user.role === "hospital") {
      const hosp = db.queryOne("SELECT id FROM hospitals WHERE user_id = ?", [req.user.id]);
      sql += " WHERE (t.destination_hospital_id = ? OR t.recipient_user_id = ?)";
      params.push(hosp ? hosp.id : -1, req.user.id);
    } else if (req.user.role === "blood_bank") {
      const bank = db.queryOne("SELECT id FROM blood_banks WHERE user_id = ?", [req.user.id]);
      sql += " WHERE t.origin_blood_bank_id = ?";
      params.push(bank ? bank.id : -1);
    } else if (req.user.role === "patient") {
      sql += " WHERE t.recipient_user_id = ?";
      params.push(req.user.id);
    }

    sql += " ORDER BY t.id DESC";
    const transports = db.queryAll(sql, params);
    res.json({ transports });
  });

  router.get("/:id", requireAuth, (req, res) => {
    const id = parsePositiveIntId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid transport ID required." } });
    }
    const transport = db.queryOne(
      `SELECT
        t.*,
        br.request_code, br.blood_group, br.units_requested, br.urgency,
        bb.name AS origin_bank_name, bb.latitude AS origin_lat, bb.longitude AS origin_lng,
        h.name AS destination_hospital_name, h.latitude AS dest_lat, h.longitude AS dest_lng,
        d.device_uid, d.name AS device_name, d.last_seen_at AS device_last_seen_at
       FROM transports t
       JOIN blood_requests br ON br.id = t.blood_request_id
       JOIN blood_banks bb ON bb.id = t.origin_blood_bank_id
       LEFT JOIN hospitals h ON h.id = t.destination_hospital_id
       JOIN devices d ON d.id = t.device_id
       WHERE t.id = ?`,
      [id]
    );
    if (!transport) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Transport not found." } });
    }
    if (!canAccessTransport(db, req.user, transport)) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied to this transport." } });
    }
    res.json({ transport });
  });

  router.patch("/:id/deliver", requireAuth, requireRole("hospital", "blood_bank", "admin"), (req, res) => {
    const id = parsePositiveIntId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid transport ID required." } });
    }
    const transport = db.queryOne("SELECT * FROM transports WHERE id = ?", [id]);
    if (!transport) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Transport not found." } });
    }
    if (!canAccessTransport(db, req.user, transport)) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied to this transport." } });
    }
    if (!["assigned", "in_transit", "arrived"].includes(transport.status)) {
      return res.status(409).json({
        error: { code: "INVALID_STATE", message: `Cannot deliver transport in status '${transport.status}'.` }
      });
    }

    db.transaction(() => {
      db.execute(
        "UPDATE transports SET status = 'delivered', delivered_at = datetime('now') WHERE id = ?",
        [id]
      );
      db.execute(
        "UPDATE blood_requests SET status = 'delivered', updated_at = datetime('now') WHERE id = ?",
        [transport.blood_request_id]
      );
      db.execute(
        "UPDATE otp_tokens SET used_at = COALESCE(used_at, datetime('now')), unlock_token_hash = NULL, unlock_expires_at = NULL WHERE transport_id = ?",
        [id]
      );
      recordAudit(db, {
        actorUserId: req.user.id,
        actorRole: req.user.role,
        action: "transport.delivered",
        entityType: "transport",
        entityId: id,
        ipAddress: req.ip
      });
    });

    res.json({ transport: db.queryOne("SELECT * FROM transports WHERE id = ?", [id]) });
  });

  return router;
}
