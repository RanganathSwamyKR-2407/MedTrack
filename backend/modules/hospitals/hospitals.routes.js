import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { validateBody } from "../../middleware/validate.js";
import { requireAuth, requireRole, signAuthToken } from "../../middleware/auth.js";
import { haversineDistanceKm, estimateTravelMinutes } from "../../utils/geo.js";
import { recordAudit } from "../../utils/audit.js";
import { notificationService } from "../../services/notificationService.js";

const hospitalRegisterSchema = z.object({
  hospitalName: z.string().min(2).max(150),
  registrationNumber: z.string().min(3).max(80),
  hospitalType: z.string().min(2).max(80),
  contactPerson: z.string().min(2).max(120),
  officialEmail: z.string().email(),
  mobile: z.string().regex(/^[0-9+\-\s]{10,15}$/, "Valid 10-15 digit mobile required"),
  password: z.string().min(6).max(128).optional(),
  address: z.string().min(5).max(250),
  state: z.string().min(2).max(80),
  city: z.string().min(2).max(80),
  pinCode: z.string().regex(/^[0-9]{4,10}$/, "Valid PIN code required"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  specialists: z.array(z.string()).optional(),
  facilities: z.array(z.string()).optional()
});

const hospitalUpdateSchema = z.object({
  name: z.string().min(2).max(150).optional(),
  hospitalType: z.string().min(2).max(80).optional(),
  contactPerson: z.string().min(2).max(120).optional(),
  mobile: z.string().regex(/^[0-9+\-\s]{10,15}$/).optional(),
  address: z.string().min(5).max(250).optional(),
  city: z.string().min(2).max(80).optional(),
  state: z.string().min(2).max(80).optional(),
  pinCode: z.string().regex(/^[0-9]{4,10}$/).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  generalBeds: z.number().int().min(0).optional(),
  icuBeds: z.number().int().min(0).optional(),
  emergencyBeds: z.number().int().min(0).optional(),
  ambulances: z.number().int().min(0).optional(),
  facilities: z.array(z.string()).optional(),
  specialists: z.array(z.string()).optional(),
  status: z.enum(["active", "limited", "full"]).optional()
});

export function formatHospital(row, userLat = null, userLng = null) {
  const specialists = JSON.parse(row.specialists_json || "[]");
  const facilitiesList = JSON.parse(row.facilities_json || "[]");
  const distanceKm =
    userLat !== null && userLng !== null
      ? Number(haversineDistanceKm(userLat, userLng, row.latitude, row.longitude).toFixed(2))
      : null;

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    registrationNumber: row.registration_number,
    hospitalType: row.hospital_type,
    contactPerson: row.contact_person,
    officialEmail: row.official_email,
    phone: row.mobile,
    mobile: row.mobile,
    address: row.address,
    city: row.city,
    state: row.state,
    pinCode: row.pin_code,
    latitude: row.latitude,
    longitude: row.longitude,
    lat: row.latitude,
    lng: row.longitude,
    verificationStatus: row.verification_status,
    verified: row.verification_status === "approved",
    beds: {
      general: row.general_beds,
      icu: row.icu_beds,
      emergency: row.emergency_beds
    },
    ambulances: row.ambulances,
    rating: row.rating,
    travelTime: distanceKm !== null ? estimateTravelMinutes(distanceKm) : row.travel_time_min,
    distanceKm,
    emergency: Boolean(row.emergency_capable),
    specialists,
    facilitiesList,
    facilities: {
      ventilator: facilitiesList.includes("Ventilator"),
      oxygen: facilitiesList.includes("Oxygen"),
      blood: facilitiesList.includes("Blood Bank"),
      ct: facilitiesList.includes("CT Scan"),
      mri: facilitiesList.includes("MRI")
    },
    status: row.status,
    lastUpdated: row.last_updated_at
  };
}

export function createHospitalsRouter(db) {
  const router = express.Router();

  router.post("/register", validateBody(hospitalRegisterSchema), (req, res) => {
    const data = req.validatedBody;
    const email = data.officialEmail.trim().toLowerCase();

    const dupReg = db.queryOne("SELECT id FROM hospitals WHERE registration_number = ?", [
      data.registrationNumber.trim()
    ]);
    if (dupReg) {
      return res.status(409).json({
        error: { code: "DUPLICATE_REGISTRATION", message: "Hospital registration number already exists." }
      });
    }

    let ownerUserId = req.user?.id || null;
    let issuedToken = null;
    let createdUser = null;

    const result = db.transaction(() => {
      if (!ownerUserId) {
        if (!data.password) {
          throw Object.assign(new Error("Password is required for new hospital registration."), {
            statusCode: 400,
            code: "PASSWORD_REQUIRED"
          });
        }
        const existingEmail = db.queryOne("SELECT id FROM users WHERE email = ?", [email]);
        if (existingEmail) {
          throw Object.assign(new Error("An account with this official email already exists."), {
            statusCode: 409,
            code: "EMAIL_EXISTS"
          });
        }

        const names = data.contactPerson.trim().split(/\s+/);
        const firstName = names[0] || data.contactPerson;
        const lastName = names.slice(1).join(" ") || "Staff";
        const passwordHash = bcrypt.hashSync(data.password, 10);

        const userRes = db.execute(
          `INSERT INTO users (first_name, last_name, email, phone, password_hash, role)
           VALUES (?, ?, ?, ?, ?, 'hospital')`,
          [firstName, lastName, email, data.mobile.trim(), passwordHash]
        );
        ownerUserId = userRes.lastInsertRowid;
        createdUser = db.queryOne("SELECT * FROM users WHERE id = ?", [ownerUserId]);
        issuedToken = signAuthToken(createdUser);
      } else if (req.user.role !== "hospital" && req.user.role !== "admin") {
        throw Object.assign(new Error("Only hospital or admin accounts can register a hospital."), {
          statusCode: 403,
          code: "FORBIDDEN"
        });
      }

      const hospRes = db.execute(
        `INSERT INTO hospitals (
          user_id, name, registration_number, hospital_type, contact_person, official_email,
          mobile, address, city, state, pin_code, latitude, longitude, verification_status,
          specialists_json, facilities_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [
          ownerUserId,
          data.hospitalName.trim(),
          data.registrationNumber.trim(),
          data.hospitalType.trim(),
          data.contactPerson.trim(),
          email,
          data.mobile.trim(),
          data.address.trim(),
          data.city.trim(),
          data.state.trim(),
          data.pinCode.trim(),
          data.latitude,
          data.longitude,
          JSON.stringify(data.specialists || ["Emergency Medicine"]),
          JSON.stringify(data.facilities || ["Emergency", "ICU", "Oxygen"])
        ]
      );

      notificationService.createAlert(db, {
        targetRole: "admin",
        targetHospitalId: hospRes.lastInsertRowid,
        severity: "info",
        category: "verification",
        title: "New Hospital Pending Verification",
        message: `${data.hospitalName} (${data.city}, ${data.state}) submitted registration ${data.registrationNumber}.`
      });

      recordAudit(db, {
        actorUserId: ownerUserId,
        actorRole: createdUser ? createdUser.role : req.user?.role,
        action: "hospital.registered",
        entityType: "hospital",
        entityId: hospRes.lastInsertRowid,
        ipAddress: req.ip
      });

      return db.queryOne("SELECT * FROM hospitals WHERE id = ?", [hospRes.lastInsertRowid]);
    });

    res.status(201).json({
      hospital: formatHospital(result),
      ...(issuedToken ? { token: issuedToken } : {})
    });
  });

  router.get("/", (req, res) => {
    const search = (req.query.search || "").toString().trim().toLowerCase();
    const city = (req.query.city || "").toString().trim().toLowerCase();
    const includePending = req.query.includePending === "true" && req.user?.role === "admin";

    const rows = db.queryAll(
      includePending
        ? "SELECT * FROM hospitals ORDER BY id ASC"
        : "SELECT * FROM hospitals WHERE verification_status = 'approved' ORDER BY id ASC"
    );

    const userLat = req.query.lat !== undefined ? Number(req.query.lat) : null;
    const userLng = req.query.lng !== undefined ? Number(req.query.lng) : null;
    const hasCoords = Number.isFinite(userLat) && Number.isFinite(userLng);

    let hospitals = rows.map((r) => formatHospital(r, hasCoords ? userLat : null, hasCoords ? userLng : null));

    if (city) {
      hospitals = hospitals.filter((h) => h.city.toLowerCase().includes(city));
    }
    if (search) {
      hospitals = hospitals.filter(
        (h) =>
          h.name.toLowerCase().includes(search) ||
          h.city.toLowerCase().includes(search) ||
          h.state.toLowerCase().includes(search) ||
          h.address.toLowerCase().includes(search) ||
          h.specialists.join(" ").toLowerCase().includes(search)
      );
    }

    res.json({ hospitals });
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

    const rows = db.queryAll("SELECT * FROM hospitals WHERE verification_status = 'approved'");
    const hospitals = rows
      .map((r) => formatHospital(r, lat, lng))
      .filter((h) => h.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    res.json({ hospitals });
  });

  router.get("/my/profile", requireAuth, requireRole("hospital", "admin"), (req, res) => {
    const row = db.queryOne("SELECT * FROM hospitals WHERE user_id = ?", [req.user.id]);
    if (!row) {
      return res.status(404).json({
        error: { code: "HOSPITAL_NOT_FOUND", message: "No hospital profile linked to this account." }
      });
    }
    res.json({ hospital: formatHospital(row) });
  });

  router.get("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid hospital ID required." } });
    }
    const row = db.queryOne("SELECT * FROM hospitals WHERE id = ?", [id]);
    if (!row) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Hospital not found." } });
    }
    const canSeeUnapproved = req.user?.role === "admin" || (req.user && row.user_id === req.user.id);
    if (row.verification_status !== "approved" && !canSeeUnapproved) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Hospital not found." } });
    }
    res.json({ hospital: formatHospital(row) });
  });

  router.patch("/:id", requireAuth, requireRole("hospital", "admin"), validateBody(hospitalUpdateSchema), (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid hospital ID required." } });
    }
    const row = db.queryOne("SELECT * FROM hospitals WHERE id = ?", [id]);
    if (!row) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Hospital not found." } });
    }
    if (req.user.role !== "admin" && row.user_id !== req.user.id) {
      return res.status(403).json({
        error: { code: "FORBIDDEN", message: "You can only update your own hospital profile." }
      });
    }

    const d = req.validatedBody;
    db.execute(
      `UPDATE hospitals SET
        name = COALESCE(?, name),
        hospital_type = COALESCE(?, hospital_type),
        contact_person = COALESCE(?, contact_person),
        mobile = COALESCE(?, mobile),
        address = COALESCE(?, address),
        city = COALESCE(?, city),
        state = COALESCE(?, state),
        pin_code = COALESCE(?, pin_code),
        latitude = COALESCE(?, latitude),
        longitude = COALESCE(?, longitude),
        general_beds = COALESCE(?, general_beds),
        icu_beds = COALESCE(?, icu_beds),
        emergency_beds = COALESCE(?, emergency_beds),
        ambulances = COALESCE(?, ambulances),
        facilities_json = COALESCE(?, facilities_json),
        specialists_json = COALESCE(?, specialists_json),
        status = COALESCE(?, status),
        last_updated_at = datetime('now')
      WHERE id = ?`,
      [
        d.name ?? null,
        d.hospitalType ?? null,
        d.contactPerson ?? null,
        d.mobile ?? null,
        d.address ?? null,
        d.city ?? null,
        d.state ?? null,
        d.pinCode ?? null,
        d.latitude ?? null,
        d.longitude ?? null,
        d.generalBeds ?? null,
        d.icuBeds ?? null,
        d.emergencyBeds ?? null,
        d.ambulances ?? null,
        d.facilities ? JSON.stringify(d.facilities) : null,
        d.specialists ? JSON.stringify(d.specialists) : null,
        d.status ?? null,
        id
      ]
    );

    const updated = db.queryOne("SELECT * FROM hospitals WHERE id = ?", [id]);
    recordAudit(db, {
      actorUserId: req.user.id,
      actorRole: req.user.role,
      action: "hospital.updated",
      entityType: "hospital",
      entityId: id,
      metadata: d,
      ipAddress: req.ip
    });

    res.json({ hospital: formatHospital(updated) });
  });

  return router;
}
