import express from "express";
import { z } from "zod";
import { validateBody } from "../../middleware/validate.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { BLOOD_GROUPS, computeStockStatus } from "../../db/seed.js";
import { haversineDistanceKm } from "../../utils/geo.js";
import { recordAudit } from "../../utils/audit.js";

const updateInventorySchema = z.object({
  bloodGroup: z.enum(["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"]),
  unitsAvailable: z.number().int().min(0).max(10000),
  lowThreshold: z.number().int().min(1).max(500).optional(),
  criticalThreshold: z.number().int().min(0).max(200).optional(),
  reason: z.string().min(2).max(200).default("Manual stock adjustment")
});

export function createInventoryRouter(db) {
  const router = express.Router();

  router.get("/search", (req, res) => {
    const bloodGroup = req.query.bloodGroup ? String(req.query.bloodGroup).trim() : null;
    const city = req.query.city ? String(req.query.city).trim().toLowerCase() : "";
    const onlyAvailable = req.query.onlyAvailable === "true";
    const lat = req.query.lat !== undefined ? Number(req.query.lat) : null;
    const lng = req.query.lng !== undefined ? Number(req.query.lng) : null;
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

    if (bloodGroup && !BLOOD_GROUPS.includes(bloodGroup)) {
      return res.status(400).json({
        error: { code: "INVALID_BLOOD_GROUP", message: "Supported blood groups: A+, A-, B+, B-, O+, O-, AB+, AB-." }
      });
    }

    let sql = `
      SELECT
        bi.id, bi.blood_bank_id, bi.blood_group, bi.units_available,
        bi.low_threshold, bi.critical_threshold, bi.status, bi.updated_at,
        bb.name AS bank_name, bb.city, bb.state, bb.address, bb.phone, bb.latitude, bb.longitude
      FROM blood_inventory bi
      JOIN blood_banks bb ON bb.id = bi.blood_bank_id
      WHERE bb.verification_status = 'approved'
    `;
    const params = [];
    if (bloodGroup) {
      sql += " AND bi.blood_group = ?";
      params.push(bloodGroup);
    }
    if (onlyAvailable) {
      sql += " AND bi.units_available > 0";
    }

    let results = db.queryAll(sql, params).map((row) => ({
      id: row.id,
      bloodBankId: row.blood_bank_id,
      bloodBankName: row.bank_name,
      city: row.city,
      state: row.state,
      address: row.address,
      phone: row.phone,
      latitude: row.latitude,
      longitude: row.longitude,
      bloodGroup: row.blood_group,
      unitsAvailable: row.units_available,
      status: row.status,
      updatedAt: row.updated_at,
      distanceKm: hasCoords
        ? Number(haversineDistanceKm(lat, lng, row.latitude, row.longitude).toFixed(2))
        : null
    }));

    if (city) {
      results = results.filter(
        (r) => r.city.toLowerCase().includes(city) || r.bloodBankName.toLowerCase().includes(city)
      );
    }

    results.sort((a, b) => {
      if (hasCoords && a.distanceKm !== null && b.distanceKm !== null) {
        return a.distanceKm - b.distanceKm;
      }
      return b.unitsAvailable - a.unitsAvailable;
    });

    res.json({ results });
  });

  router.get("/bank/:bankId", (req, res) => {
    const bankId = Number(req.params.bankId);
    if (!Number.isInteger(bankId) || bankId <= 0) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid blood bank ID required." } });
    }
    const bank = db.queryOne("SELECT * FROM blood_banks WHERE id = ?", [bankId]);
    if (!bank) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Blood bank not found." } });
    }
    const canSeeUnapproved = req.user?.role === "admin" || (req.user && bank.user_id === req.user.id);
    if (bank.verification_status !== "approved" && !canSeeUnapproved) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Blood bank not found." } });
    }
    const items = db.queryAll(
      `SELECT blood_group, units_available, low_threshold, critical_threshold, status, updated_at
       FROM blood_inventory WHERE blood_bank_id = ? ORDER BY blood_group ASC`,
      [bankId]
    );
    res.json({ bloodBankId: bankId, inventory: items });
  });

  router.put(
    "/bank/:bankId",
    requireAuth,
    requireRole("blood_bank", "admin"),
    validateBody(updateInventorySchema),
    (req, res) => {
      const bankId = Number(req.params.bankId);
      if (!Number.isInteger(bankId) || bankId <= 0) {
        return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid blood bank ID required." } });
      }
      const bank = db.queryOne("SELECT * FROM blood_banks WHERE id = ?", [bankId]);
      if (!bank) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Blood bank not found." } });
      }
      if (req.user.role !== "admin" && bank.user_id !== req.user.id) {
        return res.status(403).json({
          error: { code: "FORBIDDEN", message: "You can only manage your own blood bank inventory." }
        });
      }

      const d = req.validatedBody;
      const currentCheck = db.queryOne(
        "SELECT low_threshold, critical_threshold FROM blood_inventory WHERE blood_bank_id = ? AND blood_group = ?",
        [bankId, d.bloodGroup]
      );
      const effectiveLow = d.lowThreshold ?? (currentCheck ? currentCheck.low_threshold : 8);
      const effectiveCrit = d.criticalThreshold ?? (currentCheck ? currentCheck.critical_threshold : 3);
      if (effectiveCrit >= effectiveLow) {
        return res.status(400).json({
          error: {
            code: "INVALID_THRESHOLDS",
            message: "criticalThreshold must be strictly lower than lowThreshold."
          }
        });
      }

      const updated = db.transaction(() => {
        const current = db.queryOne(
          "SELECT * FROM blood_inventory WHERE blood_bank_id = ? AND blood_group = ?",
          [bankId, d.bloodGroup]
        );
        const prevUnits = current ? current.units_available : 0;
        const lowTh = effectiveLow;
        const critTh = effectiveCrit;
        const status = computeStockStatus(d.unitsAvailable, lowTh, critTh);

        if (current) {
          db.execute(
            `UPDATE blood_inventory
             SET units_available = ?, low_threshold = ?, critical_threshold = ?, status = ?,
                 updated_by = ?, updated_at = datetime('now')
             WHERE id = ?`,
            [d.unitsAvailable, lowTh, critTh, status, req.user.id, current.id]
          );
        } else {
          db.execute(
            `INSERT INTO blood_inventory (blood_bank_id, blood_group, units_available, low_threshold, critical_threshold, status, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [bankId, d.bloodGroup, d.unitsAvailable, lowTh, critTh, status, req.user.id]
          );
        }

        db.execute(
          `INSERT INTO inventory_history (blood_bank_id, blood_group, previous_units, delta_units, new_units, reason, changed_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [bankId, d.bloodGroup, prevUnits, d.unitsAvailable - prevUnits, d.unitsAvailable, d.reason, req.user.id]
        );

        recordAudit(db, {
          actorUserId: req.user.id,
          actorRole: req.user.role,
          action: "inventory.updated",
          entityType: "blood_inventory",
          entityId: `${bankId}:${d.bloodGroup}`,
          metadata: { previousUnits: prevUnits, newUnits: d.unitsAvailable, status, reason: d.reason },
          ipAddress: req.ip
        });

        return db.queryOne(
          "SELECT * FROM blood_inventory WHERE blood_bank_id = ? AND blood_group = ?",
          [bankId, d.bloodGroup]
        );
      });

      res.json({ item: updated });
    }
  );

  router.get("/bank/:bankId/history", requireAuth, requireRole("blood_bank", "admin"), (req, res) => {
    const bankId = Number(req.params.bankId);
    const bank = db.queryOne("SELECT * FROM blood_banks WHERE id = ?", [bankId]);
    if (!bank) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Blood bank not found." } });
    }
    if (req.user.role !== "admin" && bank.user_id !== req.user.id) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied." } });
    }
    const history = db.queryAll(
      `SELECT ih.*, u.email AS changed_by_email, u.first_name || ' ' || u.last_name AS changed_by_name
       FROM inventory_history ih
       LEFT JOIN users u ON u.id = ih.changed_by
       WHERE ih.blood_bank_id = ?
       ORDER BY ih.id DESC LIMIT 100`,
      [bankId]
    );
    res.json({ history });
  });

  return router;
}
