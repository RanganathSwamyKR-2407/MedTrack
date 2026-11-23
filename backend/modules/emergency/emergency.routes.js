import express from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { validateBody } from "../../middleware/validate.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { createRateLimiter } from "../../middleware/rateLimit.js";
import { getUserHospital, parsePositiveIntId } from "../../utils/ownership.js";
import { notificationService } from "../../services/notificationService.js";
import { recordAudit } from "../../utils/audit.js";

const createEmergencySchema = z.object({
  requestType: z.enum(["emergency", "ambulance"]).default("emergency"),
  requirement: z.string().min(2).max(60).default("Emergency"),
  hospitalId: z.number().int().positive().nullable().optional(),
  requesterName: z.string().min(2).max(100).default("Emergency Caller"),
  requesterPhone: z.string().regex(/^[0-9+\-\s]{3,15}$/, "Valid contact phone required").default("108"),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  notes: z.string().max(300).optional()
});

const updateStatusSchema = z.object({
  status: z.enum(["accepted", "dispatched", "resolved", "cancelled"])
});

export function createEmergencyRouter(db) {
  const router = express.Router();
  const createLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 20 });

  router.post("/", createLimiter, validateBody(createEmergencySchema), (req, res) => {
    const d = req.validatedBody;
    let hospital = null;
    if (d.hospitalId) {
      hospital = db.queryOne(
        "SELECT * FROM hospitals WHERE id = ? AND verification_status = 'approved'",
        [d.hospitalId]
      );
      if (!hospital) {
        return res.status(404).json({
          error: { code: "HOSPITAL_NOT_FOUND", message: "Approved hospital not found." }
        });
      }
    }

    const prefix = d.requestType === "ambulance" ? "AMB" : "ER";
    const code = `${prefix}-${crypto.randomInt(1000, 9999)}-${Date.now().toString().slice(-3)}`;

    const created = db.transaction(() => {
      const insert = db.execute(
        `INSERT INTO emergency_requests (
          request_code, request_type, requirement, hospital_id, requester_user_id,
          requester_name, requester_phone, latitude, longitude, notes, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          code,
          d.requestType,
          d.requirement.trim(),
          hospital ? hospital.id : null,
          req.user ? req.user.id : null,
          d.requesterName.trim(),
          d.requesterPhone.trim(),
          d.latitude ?? null,
          d.longitude ?? null,
          d.notes ? d.notes.trim() : null
        ]
      );

      notificationService.createAlert(db, {
        targetRole: "hospital",
        targetHospitalId: hospital ? hospital.id : null,
        severity: "critical",
        category: d.requestType,
        title: `New ${d.requestType.toUpperCase()} Request ${code}`,
        message: `${d.requirement} requested by ${d.requesterName} (${d.requesterPhone}).`
      });

      recordAudit(db, {
        actorUserId: req.user?.id || null,
        actorRole: req.user?.role || "anonymous",
        action: "emergency_request.created",
        entityType: "emergency_request",
        entityId: insert.lastInsertRowid,
        metadata: { code, requestType: d.requestType, requirement: d.requirement },
        ipAddress: req.ip
      });

      return db.queryOne("SELECT * FROM emergency_requests WHERE id = ?", [insert.lastInsertRowid]);
    });

    res.status(201).json({ emergencyRequest: created });
  });

  router.get("/", requireAuth, requireRole("hospital", "admin", "patient"), (req, res) => {
    let sql = `
      SELECT er.*, h.name AS hospital_name, h.city AS hospital_city
      FROM emergency_requests er
      LEFT JOIN hospitals h ON h.id = er.hospital_id
    `;
    const params = [];

    if (req.user.role === "hospital") {
      const hosp = getUserHospital(db, req.user.id);
      sql += " WHERE er.hospital_id = ? OR er.hospital_id IS NULL";
      params.push(hosp ? hosp.id : -1);
    } else if (req.user.role === "patient") {
      sql += " WHERE er.requester_user_id = ?";
      params.push(req.user.id);
    }

    sql += " ORDER BY er.id DESC LIMIT 50";
    res.json({ requests: db.queryAll(sql, params) });
  });

  router.patch(
    "/:id/status",
    requireAuth,
    requireRole("hospital", "admin"),
    validateBody(updateStatusSchema),
    (req, res) => {
      const id = parsePositiveIntId(req.params.id);
      if (!id) {
        return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid request ID required." } });
      }
      const row = db.queryOne("SELECT * FROM emergency_requests WHERE id = ?", [id]);
      if (!row) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Emergency request not found." } });
      }

      if (req.user.role === "hospital") {
        const hosp = getUserHospital(db, req.user.id);
        if (!hosp || (row.hospital_id !== null && row.hospital_id !== hosp.id)) {
          return res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied." } });
        }
        if (row.hospital_id === null) {
          db.execute("UPDATE emergency_requests SET hospital_id = ? WHERE id = ?", [hosp.id, id]);
        }
      }

      db.execute(
        `UPDATE emergency_requests SET status = ?, handled_by = ?, updated_at = datetime('now') WHERE id = ?`,
        [req.validatedBody.status, req.user.id, id]
      );

      recordAudit(db, {
        actorUserId: req.user.id,
        actorRole: req.user.role,
        action: "emergency_request.status_updated",
        entityType: "emergency_request",
        entityId: id,
        metadata: { status: req.validatedBody.status },
        ipAddress: req.ip
      });

      res.json({ emergencyRequest: db.queryOne("SELECT * FROM emergency_requests WHERE id = ?", [id]) });
    }
  );

  return router;
}
