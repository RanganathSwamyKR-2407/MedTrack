import express from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { validateBody } from "../../middleware/validate.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { recordAudit } from "../../utils/audit.js";
import { notificationService } from "../../services/notificationService.js";

const createRequestSchema = z.object({
  bloodBankId: z.number().int().positive(),
  bloodGroup: z.enum(["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"]),
  unitsRequested: z.number().int().min(1).max(50),
  urgency: z.enum(["normal", "urgent", "critical"]).default("normal"),
  patientReference: z.string().max(120).optional(),
  recipientContact: z.string().min(6).max(30),
  notes: z.string().max(400).optional()
});

const rejectSchema = z.object({
  reason: z.string().min(3).max(250)
});

export function createBloodRequestsRouter(db) {
  const router = express.Router();

  router.post("/", requireAuth, validateBody(createRequestSchema), (req, res) => {
    const d = req.validatedBody;
    const bank = db.queryOne("SELECT * FROM blood_banks WHERE id = ?", [d.bloodBankId]);
    if (!bank) {
      return res.status(404).json({ error: { code: "BANK_NOT_FOUND", message: "Blood bank not found." } });
    }
    if (bank.verification_status !== "approved") {
      return res.status(400).json({
        error: { code: "BANK_NOT_APPROVED", message: "Blood requests can only be sent to verified blood banks." }
      });
    }

    const hospital =
      req.user.role === "hospital"
        ? db.queryOne("SELECT * FROM hospitals WHERE user_id = ?", [req.user.id])
        : null;
    if (hospital && hospital.verification_status === "rejected") {
      return res.status(403).json({
        error: { code: "HOSPITAL_REJECTED", message: "Rejected hospital accounts cannot submit blood requests." }
      });
    }

    const code = `BR-${crypto.randomInt(1000, 9999)}-${Date.now().toString().slice(-3)}`;

    const created = db.transaction(() => {
      const insert = db.execute(
        `INSERT INTO blood_requests (
          request_code, requester_hospital_id, requester_user_id, blood_bank_id,
          blood_group, units_requested, urgency, patient_reference, recipient_contact, notes, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          code,
          hospital ? hospital.id : null,
          req.user.id,
          d.bloodBankId,
          d.bloodGroup,
          d.unitsRequested,
          d.urgency,
          d.patientReference || null,
          d.recipientContact.trim(),
          d.notes || null
        ]
      );

      notificationService.createAlert(db, {
        targetRole: "blood_bank",
        targetBloodBankId: d.bloodBankId,
        severity: d.urgency === "critical" ? "critical" : "info",
        category: "blood_request",
        title: `New ${d.urgency.toUpperCase()} Blood Request (${d.bloodGroup})`,
        message: `${hospital ? hospital.name : req.user.email} requested ${d.unitsRequested} unit(s) of ${d.bloodGroup}.`
      });

      recordAudit(db, {
        actorUserId: req.user.id,
        actorRole: req.user.role,
        action: "blood_request.created",
        entityType: "blood_request",
        entityId: insert.lastInsertRowid,
        metadata: { code, bloodGroup: d.bloodGroup, units: d.unitsRequested },
        ipAddress: req.ip
      });

      return db.queryOne("SELECT * FROM blood_requests WHERE id = ?", [insert.lastInsertRowid]);
    });

    res.status(201).json({ bloodRequest: created });
  });

  router.get("/", requireAuth, (req, res) => {
    let sql = `
      SELECT
        br.*,
        h.name AS hospital_name, h.city AS hospital_city,
        bb.name AS blood_bank_name, bb.city AS blood_bank_city,
        t.id AS transport_id, t.transport_code, t.status AS transport_status, t.device_id
      FROM blood_requests br
      LEFT JOIN hospitals h ON h.id = br.requester_hospital_id
      JOIN blood_banks bb ON bb.id = br.blood_bank_id
      LEFT JOIN transports t ON t.blood_request_id = br.id
    `;
    const params = [];

    if (req.user.role === "hospital") {
      const hosp = db.queryOne("SELECT id FROM hospitals WHERE user_id = ?", [req.user.id]);
      sql += " WHERE (br.requester_user_id = ? OR br.requester_hospital_id = ?)";
      params.push(req.user.id, hosp ? hosp.id : -1);
    } else if (req.user.role === "blood_bank") {
      const bank = db.queryOne("SELECT id FROM blood_banks WHERE user_id = ?", [req.user.id]);
      sql += " WHERE br.blood_bank_id = ?";
      params.push(bank ? bank.id : -1);
    } else if (req.user.role === "patient") {
      sql += " WHERE br.requester_user_id = ?";
      params.push(req.user.id);
    }

    sql += " ORDER BY br.id DESC";
    const requests = db.queryAll(sql, params);
    res.json({ requests });
  });

  router.patch("/:id/accept", requireAuth, requireRole("blood_bank", "admin"), (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid request ID required." } });
    }
    const requestRow = db.queryOne("SELECT * FROM blood_requests WHERE id = ?", [id]);
    if (!requestRow) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Blood request not found." } });
    }

    const bank = db.queryOne("SELECT * FROM blood_banks WHERE id = ?", [requestRow.blood_bank_id]);
    if (req.user.role !== "admin" && bank.user_id !== req.user.id) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied." } });
    }
    if (requestRow.status !== "pending") {
      return res.status(409).json({
        error: { code: "INVALID_STATE", message: `Cannot accept request in status '${requestRow.status}'.` }
      });
    }

    const inv = db.queryOne(
      "SELECT * FROM blood_inventory WHERE blood_bank_id = ? AND blood_group = ?",
      [requestRow.blood_bank_id, requestRow.blood_group]
    );
    if (!inv || inv.units_available < requestRow.units_requested) {
      return res.status(409).json({
        error: {
          code: "INSUFFICIENT_STOCK",
          message: `Insufficient ${requestRow.blood_group} stock (available: ${inv ? inv.units_available : 0}).`
        }
      });
    }

    db.execute(
      `UPDATE blood_requests SET status = 'accepted', decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
      [req.user.id, id]
    );

    if (requestRow.requester_hospital_id) {
      notificationService.createAlert(db, {
        targetRole: "hospital",
        targetHospitalId: requestRow.requester_hospital_id,
        severity: "info",
        category: "blood_request",
        title: `Request ${requestRow.request_code} Accepted`,
        message: `${bank.name} accepted ${requestRow.units_requested} unit(s) of ${requestRow.blood_group}. Ready for dispatch.`
      });
    }

    recordAudit(db, {
      actorUserId: req.user.id,
      actorRole: req.user.role,
      action: "blood_request.accepted",
      entityType: "blood_request",
      entityId: id,
      ipAddress: req.ip
    });

    const updated = db.queryOne("SELECT * FROM blood_requests WHERE id = ?", [id]);
    res.json({ bloodRequest: updated });
  });

  router.patch("/:id/reject", requireAuth, requireRole("blood_bank", "admin"), validateBody(rejectSchema), (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid request ID required." } });
    }
    const requestRow = db.queryOne("SELECT * FROM blood_requests WHERE id = ?", [id]);
    if (!requestRow) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Blood request not found." } });
    }

    const bank = db.queryOne("SELECT * FROM blood_banks WHERE id = ?", [requestRow.blood_bank_id]);
    if (req.user.role !== "admin" && bank.user_id !== req.user.id) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied." } });
    }
    if (!["pending", "accepted"].includes(requestRow.status)) {
      return res.status(409).json({
        error: { code: "INVALID_STATE", message: `Cannot reject request in status '${requestRow.status}'.` }
      });
    }

    db.execute(
      `UPDATE blood_requests SET status = 'rejected', rejection_reason = ?, decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
      [req.validatedBody.reason, req.user.id, id]
    );

    if (requestRow.requester_hospital_id) {
      notificationService.createAlert(db, {
        targetRole: "hospital",
        targetHospitalId: requestRow.requester_hospital_id,
        severity: "warning",
        category: "blood_request",
        title: `Request ${requestRow.request_code} Rejected`,
        message: `${bank.name} declined request: ${req.validatedBody.reason}`
      });
    }

    recordAudit(db, {
      actorUserId: req.user.id,
      actorRole: req.user.role,
      action: "blood_request.rejected",
      entityType: "blood_request",
      entityId: id,
      metadata: { reason: req.validatedBody.reason },
      ipAddress: req.ip
    });

    res.json({ bloodRequest: db.queryOne("SELECT * FROM blood_requests WHERE id = ?", [id]) });
  });

  return router;
}
