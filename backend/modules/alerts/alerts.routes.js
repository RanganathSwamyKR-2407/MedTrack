import express from "express";
import { requireAuth } from "../../middleware/auth.js";
import { getUserHospital, getUserBloodBank, parsePositiveIntId } from "../../utils/ownership.js";
import { syncDeviceOfflineAlerts } from "../devices/devices.routes.js";

function canAccessAlert(db, user, alert) {
  if (!user || !alert) return false;
  if (user.role === "admin") return true;
  if (user.role === "hospital") {
    const hosp = getUserHospital(db, user.id);
    if (hosp && alert.target_hospital_id === hosp.id) return true;
    return alert.target_role === "hospital" && alert.target_hospital_id === null;
  }
  if (user.role === "blood_bank") {
    const bank = getUserBloodBank(db, user.id);
    if (bank && alert.target_blood_bank_id === bank.id) return true;
    return alert.target_role === "blood_bank" && alert.target_blood_bank_id === null;
  }
  if (user.role === "patient") {
    return alert.target_role === "patient";
  }
  return false;
}

export function createAlertsRouter(db) {
  const router = express.Router();

  router.get("/", requireAuth, (req, res) => {
    syncDeviceOfflineAlerts(db);
    let sql = "SELECT * FROM alerts";
    const params = [];

    if (req.user.role === "hospital") {
      const hosp = getUserHospital(db, req.user.id);
      sql += " WHERE (target_role = 'hospital' AND target_hospital_id IS NULL) OR target_hospital_id = ?";
      params.push(hosp ? hosp.id : -1);
    } else if (req.user.role === "blood_bank") {
      const bank = getUserBloodBank(db, req.user.id);
      sql += " WHERE (target_role = 'blood_bank' AND target_blood_bank_id IS NULL) OR target_blood_bank_id = ?";
      params.push(bank ? bank.id : -1);
    } else if (req.user.role === "patient") {
      sql += " WHERE target_role = 'patient'";
    }

    sql += " ORDER BY id DESC LIMIT 100";
    res.json({ alerts: db.queryAll(sql, params) });
  });

  router.patch("/:id/acknowledge", requireAuth, (req, res) => {
    const id = parsePositiveIntId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid alert ID required." } });
    }
    const alert = db.queryOne("SELECT * FROM alerts WHERE id = ?", [id]);
    if (!alert) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Alert not found." } });
    }
    if (!canAccessAlert(db, req.user, alert)) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied for this alert." } });
    }
    db.execute(
      "UPDATE alerts SET acknowledged_by = ?, acknowledged_at = datetime('now') WHERE id = ?",
      [req.user.id, id]
    );
    res.json({ alert: db.queryOne("SELECT * FROM alerts WHERE id = ?", [id]) });
  });

  return router;
}
