import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { validateBody } from "../../middleware/validate.js";
import { requireAuth, requireRole, signAuthToken } from "../../middleware/auth.js";
import { BLOOD_GROUPS, computeStockStatus } from "../../db/seed.js";
import { haversineDistanceKm } from "../../utils/geo.js";
import { recordAudit } from "../../utils/audit.js";
import { notificationService } from "../../services/notificationService.js";

const bloodBankRegisterSchema = z.object({
  name: z.string().min(2).max(150),
  licenseNumber: z.string().min(3).max(80),
  contactPerson: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().regex(/^[0-9+\-\s]{10,15}$/),
  password: z.string().min(6).max(128).optional(),
  address: z.string().min(5).max(250),
  city: z.string().min(2).max(80),
  state: z.string().min(2).max(80),
  pinCode: z.string().regex(/^[0-9]{4,10}$/),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

function formatBloodBank(row, userLat = null, userLng = null) {
  const distanceKm =
    userLat !== null && userLng !== null
      ? Number(haversineDistanceKm(userLat, userLng, row.latitude, row.longitude).toFixed(2))
      : null;

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    licenseNumber: row.license_number,
    contactPerson: row.contact_person,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    state: row.state,
    pinCode: row.pin_code,
    latitude: row.latitude,
    longitude: row.longitude,
    verificationStatus: row.verification_status,
    distanceKm,
    updatedAt: row.updated_at
  };
}

export function createBloodBanksRouter(db) {
  const router = express.Router();

  router.post("/register", validateBody(bloodBankRegisterSchema), (req, res) => {
    const data = req.validatedBody;
    const email = data.email.trim().toLowerCase();

    const dup = db.queryOne("SELECT id FROM blood_banks WHERE license_number = ?", [
      data.licenseNumber.trim()
    ]);
    if (dup) {
      return res.status(409).json({
        error: { code: "DUPLICATE_LICENSE", message: "Blood bank license number already exists." }
      });
    }

    let ownerUserId = req.user?.id || null;
    let issuedToken = null;

    const bank = db.transaction(() => {
      if (!ownerUserId) {
        if (!data.password) {
          throw Object.assign(new Error("Password is required for new blood bank registration."), {
            statusCode: 400,
            code: "PASSWORD_REQUIRED"
          });
        }
        const existingEmail = db.queryOne("SELECT id FROM users WHERE email = ?", [email]);
        if (existingEmail) {
          throw Object.assign(new Error("Account with this email already exists."), {
            statusCode: 409,
            code: "EMAIL_EXISTS"
          });
        }
        const names = data.contactPerson.trim().split(/\s+/);
        const userRes = db.execute(
          `INSERT INTO users (first_name, last_name, email, phone, password_hash, role)
           VALUES (?, ?, ?, ?, ?, 'blood_bank')`,
          [
            names[0] || data.contactPerson,
            names.slice(1).join(" ") || "Coordinator",
            email,
            data.phone.trim(),
            bcrypt.hashSync(data.password, 10)
          ]
        );
        ownerUserId = userRes.lastInsertRowid;
        const createdUser = db.queryOne("SELECT * FROM users WHERE id = ?", [ownerUserId]);
        issuedToken = signAuthToken(createdUser);
      } else if (req.user.role !== "blood_bank" && req.user.role !== "admin") {
        throw Object.assign(new Error("Only blood bank or admin accounts can register a blood bank."), {
          statusCode: 403,
          code: "FORBIDDEN"
        });
      }

      const bankRes = db.execute(
        `INSERT INTO blood_banks (
          user_id, name, license_number, contact_person, email, phone,
          address, city, state, pin_code, latitude, longitude, verification_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          ownerUserId,
          data.name.trim(),
          data.licenseNumber.trim(),
          data.contactPerson.trim(),
          email,
          data.phone.trim(),
          data.address.trim(),
          data.city.trim(),
          data.state.trim(),
          data.pinCode.trim(),
          data.latitude,
          data.longitude
        ]
      );

      for (const group of BLOOD_GROUPS) {
        db.execute(
          `INSERT INTO blood_inventory (blood_bank_id, blood_group, units_available, status, updated_by)
           VALUES (?, ?, 0, ?, ?)`,
          [bankRes.lastInsertRowid, group, computeStockStatus(0), ownerUserId]
        );
      }

      notificationService.createAlert(db, {
        targetRole: "admin",
        targetBloodBankId: bankRes.lastInsertRowid,
        severity: "info",
        category: "verification",
        title: "New Blood Bank Pending Verification",
        message: `${data.name} (${data.city}) registered with license ${data.licenseNumber}.`
      });

      recordAudit(db, {
        actorUserId: ownerUserId,
        actorRole: "blood_bank",
        action: "blood_bank.registered",
        entityType: "blood_bank",
        entityId: bankRes.lastInsertRowid,
        ipAddress: req.ip
      });

      return db.queryOne("SELECT * FROM blood_banks WHERE id = ?", [bankRes.lastInsertRowid]);
    });

    res.status(201).json({
      bloodBank: formatBloodBank(bank),
      ...(issuedToken ? { token: issuedToken } : {})
    });
  });

  router.get("/", (req, res) => {
    const includePending = req.query.includePending === "true" && req.user?.role === "admin";
    const rows = db.queryAll(
      includePending
        ? "SELECT * FROM blood_banks ORDER BY id ASC"
        : "SELECT * FROM blood_banks WHERE verification_status = 'approved' ORDER BY id ASC"
    );
    const lat = req.query.lat !== undefined ? Number(req.query.lat) : null;
    const lng = req.query.lng !== undefined ? Number(req.query.lng) : null;
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

    const bloodBanks = rows.map((r) => formatBloodBank(r, hasCoords ? lat : null, hasCoords ? lng : null));
    res.json({ bloodBanks });
  });

  router.get("/nearby", (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radiusKm = Number(req.query.radiusKm) || 50;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({
        error: { code: "INVALID_COORDINATES", message: "Valid lat and lng query parameters are required." }
      });
    }
    const rows = db.queryAll("SELECT * FROM blood_banks WHERE verification_status = 'approved'");
    const bloodBanks = rows
      .map((r) => formatBloodBank(r, lat, lng))
      .filter((b) => b.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    res.json({ bloodBanks });
  });

  router.get("/my/profile", requireAuth, requireRole("blood_bank", "admin"), (req, res) => {
    const row = db.queryOne("SELECT * FROM blood_banks WHERE user_id = ?", [req.user.id]);
    if (!row) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Blood bank profile not found." } });
    }
    res.json({ bloodBank: formatBloodBank(row) });
  });

  router.get("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid blood bank ID required." } });
    }
    const row = db.queryOne("SELECT * FROM blood_banks WHERE id = ?", [id]);
    if (!row) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Blood bank not found." } });
    }
    const canSeeUnapproved = req.user?.role === "admin" || (req.user && row.user_id === req.user.id);
    if (row.verification_status !== "approved" && !canSeeUnapproved) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Blood bank not found." } });
    }
    const inventory = db.queryAll(
      "SELECT blood_group, units_available, low_threshold, critical_threshold, status, updated_at FROM blood_inventory WHERE blood_bank_id = ?",
      [row.id]
    );
    res.json({ bloodBank: formatBloodBank(row), inventory });
  });

  const bloodBankUpdateSchema = z.object({
    name: z.string().min(2).max(150).optional(),
    contactPerson: z.string().min(2).max(120).optional(),
    phone: z.string().regex(/^[0-9+\-\s]{10,15}$/).optional(),
    address: z.string().min(5).max(250).optional(),
    city: z.string().min(2).max(80).optional(),
    state: z.string().min(2).max(80).optional(),
    pinCode: z.string().regex(/^[0-9]{4,10}$/).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional()
  });

  router.patch("/:id", requireAuth, requireRole("blood_bank", "admin"), validateBody(bloodBankUpdateSchema), (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid blood bank ID required." } });
    }
    const row = db.queryOne("SELECT * FROM blood_banks WHERE id = ?", [id]);
    if (!row) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Blood bank not found." } });
    }
    if (req.user.role !== "admin" && row.user_id !== req.user.id) {
      return res.status(403).json({
        error: { code: "FORBIDDEN", message: "You can only update your own blood bank profile." }
      });
    }
    const d = req.validatedBody;
    db.execute(
      `UPDATE blood_banks SET
        name = COALESCE(?, name),
        contact_person = COALESCE(?, contact_person),
        phone = COALESCE(?, phone),
        address = COALESCE(?, address),
        city = COALESCE(?, city),
        state = COALESCE(?, state),
        pin_code = COALESCE(?, pin_code),
        latitude = COALESCE(?, latitude),
        longitude = COALESCE(?, longitude),
        updated_at = datetime('now')
      WHERE id = ?`,
      [
        d.name ?? null,
        d.contactPerson ?? null,
        d.phone ?? null,
        d.address ?? null,
        d.city ?? null,
        d.state ?? null,
        d.pinCode ?? null,
        d.latitude ?? null,
        d.longitude ?? null,
        id
      ]
    );
    const updated = db.queryOne("SELECT * FROM blood_banks WHERE id = ?", [id]);
    recordAudit(db, {
      actorUserId: req.user.id,
      actorRole: req.user.role,
      action: "blood_bank.updated",
      entityType: "blood_bank",
      entityId: id,
      metadata: d,
      ipAddress: req.ip
    });
    res.json({ bloodBank: formatBloodBank(updated) });
  });

  return router;
}
