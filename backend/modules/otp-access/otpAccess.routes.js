import express from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { validateBody } from "../../middleware/validate.js";
import { requireAuth, requireRole, requireDeviceAuth } from "../../middleware/auth.js";
import { createRateLimiter } from "../../middleware/rateLimit.js";
import { config } from "../../config/env.js";
import { generateSecureOtp, hashOtpSecret, timingSafeHexCompare } from "./otpService.js";
import { notificationService } from "../../services/notificationService.js";
import { recordAudit } from "../../utils/audit.js";
import { canAccessTransport, parsePositiveIntId } from "../../utils/ownership.js";

const generateOtpSchema = z.object({
  transportId: z.coerce.number().int().positive(),
  ttlSeconds: z.coerce.number().int().min(30).max(86400).optional(),
  recipientContact: z.string().max(80).optional()
});

const verifyOtpSchema = z.object({
  transportId: z.coerce.number().int().positive().optional(),
  otp: z.string().regex(/^[0-9]{6}$/, "OTP must be a 6-digit numeric code")
});

const doorEventSchema = z.object({
  transportId: z.number().int().positive().optional(),
  eventType: z.enum(["door_opened", "door_closed"]),
  unlockToken: z.string().min(1).optional()
});

function verifyOtpCore(db, { transport, device, otp, actorUserId = null, sourceIp = null }) {
  const nowIso = new Date().toISOString();
  const activeOtp = db.queryOne(
    `SELECT * FROM otp_tokens
     WHERE transport_id = ? AND used_at IS NULL
     ORDER BY id DESC LIMIT 1`,
    [transport.id]
  );

  if (!activeOtp) {
    db.execute(
      `INSERT INTO access_logs (transport_id, device_id, event_type, success, details, actor_user_id, source_ip)
       VALUES (?, ?, 'otp_invalid', 0, 'No active OTP exists for this transport', ?, ?)`,
      [transport.id, device.id, actorUserId, sourceIp]
    );
    return { ok: false, statusCode: 400, code: "OTP_NOT_FOUND", message: "No active OTP available." };
  }

  if (activeOtp.locked_until && new Date(activeOtp.locked_until).getTime() > Date.now()) {
    db.execute(
      `INSERT INTO access_logs (transport_id, device_id, event_type, success, details, actor_user_id, source_ip)
       VALUES (?, ?, 'lockout', 0, 'Attempted OTP entry while locked out', ?, ?)`,
      [transport.id, device.id, actorUserId, sourceIp]
    );
    return {
      ok: false,
      statusCode: 429,
      code: "OTP_LOCKED_OUT",
      message: "Door access temporarily locked due to repeated invalid OTP attempts."
    };
  }

  if (new Date(activeOtp.expires_at).getTime() < Date.now()) {
    db.execute(
      `INSERT INTO access_logs (transport_id, device_id, event_type, success, details, actor_user_id, source_ip)
       VALUES (?, ?, 'otp_invalid', 0, 'OTP expired', ?, ?)`,
      [transport.id, device.id, actorUserId, sourceIp]
    );
    return { ok: false, statusCode: 400, code: "OTP_EXPIRED", message: "OTP has expired. Request a new OTP." };
  }

  const candidateHash = hashOtpSecret(otp);
  const valid = timingSafeHexCompare(candidateHash, activeOtp.otp_hash);

  if (!valid) {
    const nextAttempts = activeOtp.failed_attempts + 1;
    const lockedUntil =
      nextAttempts >= config.otp.maxAttempts
        ? new Date(Date.now() + config.otp.lockoutSeconds * 1000).toISOString()
        : null;

    db.execute(
      "UPDATE otp_tokens SET failed_attempts = ?, locked_until = ? WHERE id = ?",
      [nextAttempts, lockedUntil, activeOtp.id]
    );

    db.execute(
      `INSERT INTO access_logs (transport_id, device_id, event_type, success, details, actor_user_id, source_ip)
       VALUES (?, ?, ?, 0, ?, ?, ?)`,
      [
        transport.id,
        device.id,
        lockedUntil ? "lockout" : "otp_invalid",
        `Invalid OTP attempt ${nextAttempts}/${config.otp.maxAttempts}`,
        actorUserId,
        sourceIp
      ]
    );

    if (lockedUntil) {
      notificationService.createAlert(db, {
        targetRole: "admin",
        targetHospitalId: transport.destination_hospital_id,
        targetBloodBankId: transport.origin_blood_bank_id,
        deviceId: device.id,
        transportId: transport.id,
        severity: "critical",
        category: "security",
        title: `Smart Lockout Triggered on ${device.device_uid}`,
        message: `Repeated invalid OTP attempts (${nextAttempts}) for transport ${transport.transport_code}.`
      });
    }

    return {
      ok: false,
      statusCode: lockedUntil ? 429 : 401,
      code: lockedUntil ? "OTP_LOCKED_OUT" : "OTP_INVALID",
      message: lockedUntil
        ? "Maximum attempts exceeded. Access temporarily locked."
        : `Invalid OTP. ${config.otp.maxAttempts - nextAttempts} attempt(s) remaining.`
    };
  }

  // Valid single-use OTP -> issue short-lived unlock token independent of physical actuator implementation
  const unlockToken = crypto.randomBytes(24).toString("hex");
  const unlockTokenHash = hashOtpSecret(unlockToken);
  const unlockExpiresAt = new Date(Date.now() + config.otp.unlockTokenTtlSeconds * 1000).toISOString();

  db.transaction(() => {
    db.execute(
      `UPDATE otp_tokens SET used_at = ?, unlock_token_hash = ?, unlock_expires_at = ? WHERE id = ?`,
      [nowIso, unlockTokenHash, unlockExpiresAt, activeOtp.id]
    );
    db.execute(
      `INSERT INTO access_logs (transport_id, device_id, event_type, success, details, actor_user_id, source_ip)
       VALUES (?, ?, 'otp_valid', 1, 'OTP validated successfully', ?, ?)`,
      [transport.id, device.id, actorUserId, sourceIp]
    );
    db.execute(
      `INSERT INTO access_logs (transport_id, device_id, event_type, success, details, actor_user_id, source_ip)
       VALUES (?, ?, 'unlock_authorized', 1, ?, ?, ?)`,
      [transport.id, device.id, `Short-lived unlock authorization issued (${config.otp.unlockTokenTtlSeconds}s)`, actorUserId, sourceIp]
    );
  });

  return {
    ok: true,
    unlockAuthorized: true,
    unlockToken,
    unlockExpiresAt,
    transportCode: transport.transport_code
  };
}

function isUnlockAuthorized(db, transportId, unlockToken) {
  if (!unlockToken) return false;
  const recentAuth = db.queryOne(
    "SELECT id, unlock_token_hash, unlock_expires_at FROM otp_tokens WHERE transport_id = ? ORDER BY id DESC LIMIT 1",
    [transportId]
  );
  return Boolean(
    recentAuth &&
      recentAuth.unlock_token_hash &&
      recentAuth.unlock_expires_at &&
      new Date(recentAuth.unlock_expires_at).getTime() >= Date.now() &&
      timingSafeHexCompare(hashOtpSecret(unlockToken), recentAuth.unlock_token_hash)
  );
}

function revokeUnlockTokens(db, transportId) {
  db.execute(
    "UPDATE otp_tokens SET unlock_token_hash = NULL, unlock_expires_at = NULL WHERE transport_id = ? AND unlock_token_hash IS NOT NULL",
    [transportId]
  );
}

export function createOtpRouter(db) {
  const router = express.Router();
  const otpVerifyLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 15 });

  router.post(
    "/generate",
    requireAuth,
    requireRole("hospital", "blood_bank", "admin", "patient"),
    validateBody(generateOtpSchema),
    async (req, res) => {
      const { transportId, ttlSeconds: customTtl, recipientContact: customContact } = req.validatedBody;
      const transport = db.queryOne("SELECT * FROM transports WHERE id = ?", [transportId]);
      if (!transport) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Transport not found." } });
      }
      if (!canAccessTransport(db, req.user, transport)) {
        return res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied for this transport." } });
      }
      if (["delivered", "cancelled"].includes(transport.status)) {
        return res.status(409).json({
          error: { code: "TRANSPORT_CLOSED", message: `Cannot generate OTP for ${transport.status} transport.` }
        });
      }

      const isAdmin = req.user.role === "admin";
      const ttlSeconds = customTtl || config.otp.ttlSeconds;
      const recipientContact = customContact?.trim() || transport.recipient_contact || "Emergency Recipient";

      const rawOtp = generateSecureOtp();
      const otpHash = hashOtpSecret(rawOtp);
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

      db.transaction(() => {
        // Invalidate previous unused OTPs for this transport
        db.execute(
          "UPDATE otp_tokens SET used_at = datetime('now') WHERE transport_id = ? AND used_at IS NULL",
          [transportId]
        );
        db.execute(
          `INSERT INTO otp_tokens (transport_id, recipient_user_id, otp_hash, expires_at, created_by)
           VALUES (?, ?, ?, ?, ?)`,
          [transportId, transport.recipient_user_id || null, otpHash, expiresAt, req.user?.id || null]
        );
        db.execute(
          `INSERT INTO access_logs (transport_id, device_id, event_type, success, details, actor_user_id, source_ip)
           VALUES (?, ?, 'otp_issued', 1, ?, ?, ?)`,
          [
            transportId,
            transport.device_id || null,
            isAdmin
              ? `Master Access OTP generated by Administrator (valid ${ttlSeconds}s)`
              : `Single-use OTP generated and queued for delivery (${ttlSeconds}s)`,
            req.user?.id || null,
            req.ip || "127.0.0.1"
          ]
        );
      });

      const delivery = await notificationService.sendOtpNotification({
        recipientContact,
        transportCode: transport.transport_code,
        expiresInSeconds: ttlSeconds,
        otpPreviewForChannel: rawOtp
      });

      recordAudit(db, {
        actorUserId: req.user.id,
        actorRole: req.user.role,
        action: isAdmin ? "otp.admin_override_generated" : "otp.generated",
        entityType: "transport",
        entityId: transportId,
        metadata: { isAdminOverride: isAdmin, ttlSeconds },
        ipAddress: req.ip
      });

      // Return OTP preview when user is an administrator or when simulation mode is active
      const canPreviewOtp = isAdmin || config.simulationMode;

      res.status(201).json({
        transportId,
        transportCode: transport.transport_code,
        expiresAt,
        ttlSeconds,
        deliveryChannel: delivery.channel,
        recipientContact,
        isAdminOverride: isAdmin,
        acceptedModes: [
          "hardware_esp32_keypad",
          "dashboard_keypad_simulator",
          "physical_esp32_webserver",
          "emergency_admin_override"
        ],
        ...(canPreviewOtp ? { simulationOtpPreview: rawOtp, otpCode: rawOtp } : {})
      });
    }
  );

  // Hardware ESP32 verification endpoint (requires device authentication)
  router.post("/verify", otpVerifyLimiter, requireDeviceAuth(db), validateBody(verifyOtpSchema), (req, res) => {
    const { otp, transportId } = req.validatedBody;
    const transport = transportId
      ? db.queryOne("SELECT * FROM transports WHERE id = ? AND device_id = ?", [transportId, req.device.id])
      : db.queryOne(
          "SELECT * FROM transports WHERE device_id = ? AND status IN ('assigned', 'in_transit', 'arrived') ORDER BY id DESC LIMIT 1",
          [req.device.id]
        );

    if (!transport) {
      return res.status(404).json({
        error: { code: "NO_ACTIVE_TRANSPORT", message: "No active transport linked to this device." }
      });
    }

    const result = verifyOtpCore(db, {
      transport,
      device: req.device,
      otp,
      sourceIp: req.ip
    });

    if (!result.ok) {
      return res.status(result.statusCode).json({
        unlockAuthorized: false,
        error: { code: result.code, message: result.message }
      });
    }

    res.json(result);
  });

  // Simulation-only verification endpoint so the dashboard keypad simulator works without exposing device keys in frontend JS
  router.post(
    "/simulate-verify",
    otpVerifyLimiter,
    requireAuth,
    requireRole("hospital", "blood_bank", "admin", "patient"),
    validateBody(verifyOtpSchema),
    (req, res) => {
      if (!config.simulationMode) {
        return res.status(403).json({
          error: { code: "SIMULATION_DISABLED", message: "Simulation mode is disabled." }
        });
      }
      const { transportId, otp } = req.validatedBody;
      if (!transportId) {
        return res.status(400).json({ error: { code: "TRANSPORT_REQUIRED", message: "transportId is required." } });
      }
      const transport = db.queryOne("SELECT * FROM transports WHERE id = ?", [transportId]);
      if (!transport) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Transport not found." } });
      }
      if (!canAccessTransport(db, req.user, transport)) {
        return res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied for this transport." } });
      }
      const device = db.queryOne("SELECT * FROM devices WHERE id = ?", [transport.device_id]);
      if (!device) {
        return res.status(404).json({ error: { code: "DEVICE_NOT_FOUND", message: "Assigned device not found." } });
      }
      const result = verifyOtpCore(db, {
        transport,
        device,
        otp,
        actorUserId: req.user?.id || null,
        sourceIp: req.ip || "127.0.0.1"
      });
      if (!result.ok) {
        return res.status(result.statusCode).json({
          unlockAuthorized: false,
          error: { code: result.code, message: result.message }
        });
      }
      res.json({ simulated: true, ...result });
    }
  );

  router.get("/:transportId/status", requireAuth, (req, res) => {
    const transportId = parsePositiveIntId(req.params.transportId);
    if (!transportId) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid transport ID is required." } });
    }
    const transport = db.queryOne("SELECT * FROM transports WHERE id = ?", [transportId]);
    if (!transport) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Transport not found." } });
    }
    if (!canAccessTransport(db, req.user, transport)) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied for this transport." } });
    }

    const latestOtp = db.queryOne(
      `SELECT id, expires_at, used_at, failed_attempts, locked_until, unlock_expires_at, created_at
       FROM otp_tokens WHERE transport_id = ? ORDER BY id DESC LIMIT 1`,
      [transportId]
    );
    const logs = db.queryAll(
      "SELECT * FROM access_logs WHERE transport_id = ? ORDER BY id DESC LIMIT 20",
      [transportId]
    );
    res.json({ otpStatus: latestOtp, logs });
  });

  return router;
}

export function createAccessRouter(db) {
  const router = express.Router();

  router.post("/door-event", requireDeviceAuth(db), validateBody(doorEventSchema), (req, res) => {
    const { eventType, transportId, unlockToken } = req.validatedBody;
    const transport = transportId
      ? db.queryOne("SELECT * FROM transports WHERE id = ? AND device_id = ?", [transportId, req.device.id])
      : db.queryOne(
          "SELECT * FROM transports WHERE device_id = ? AND status IN ('assigned', 'in_transit', 'arrived') ORDER BY id DESC LIMIT 1",
          [req.device.id]
        );

    let recordedEventType = eventType;
    let success = 1;
    let details = `Reed switch reported ${eventType}`;

    if (eventType === "door_opened" && transport) {
      if (!isUnlockAuthorized(db, transport.id, unlockToken)) {
        recordedEventType = "unauthorized_door_open";
        success = 0;
        details = "Door opened without valid unlock token!";
        notificationService.createAlert(db, {
          targetRole: "admin",
          targetHospitalId: transport.destination_hospital_id,
          targetBloodBankId: transport.origin_blood_bank_id,
          deviceId: req.device.id,
          transportId: transport.id,
          severity: "critical",
          category: "security",
          title: `Unauthorized Door Opening on ${req.device.device_uid}`,
          message: `Reed switch triggered open without valid OTP unlock token on ${transport.transport_code}.`
        });
      }
    } else if (eventType === "door_closed" && transport) {
      revokeUnlockTokens(db, transport.id);
      details = "Reed switch reported door_closed; unlock authorization cleared";
    }

    db.execute(
      `INSERT INTO access_logs (transport_id, device_id, event_type, success, details, source_ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [transport ? transport.id : null, req.device.id, recordedEventType, success, details, req.ip]
    );

    res.status(201).json({ recordedEventType, success: Boolean(success) });
  });

  // Simulation door event for testing reed-switch telemetry in dev
  router.post(
    "/simulate-door-event",
    requireAuth,
    requireRole("hospital", "blood_bank", "admin", "patient"),
    validateBody(doorEventSchema),
    (req, res) => {
      if (!config.simulationMode) {
        return res.status(403).json({ error: { code: "SIMULATION_DISABLED", message: "Simulation disabled." } });
      }
      const { eventType, transportId, unlockToken } = req.validatedBody;
      if (!transportId) {
        return res.status(400).json({ error: { code: "TRANSPORT_REQUIRED", message: "transportId is required." } });
      }
      const transport = db.queryOne("SELECT * FROM transports WHERE id = ?", [transportId]);
      if (!transport) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Transport not found." } });
      }
      if (!canAccessTransport(db, req.user, transport)) {
        return res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied for this transport." } });
      }

      let recordedEventType = eventType;
      let success = 1;
      let details = `[SIMULATED] Reed switch reported ${eventType}`;

      if (eventType === "door_opened") {
        if (!isUnlockAuthorized(db, transport.id, unlockToken)) {
          recordedEventType = "unauthorized_door_open";
          success = 0;
          details = "[SIMULATED] Door opened without valid unlock token!";
          notificationService.createAlert(db, {
            targetRole: "admin",
            targetHospitalId: transport.destination_hospital_id,
            targetBloodBankId: transport.origin_blood_bank_id,
            deviceId: transport.device_id,
            transportId: transport.id,
            severity: "critical",
            category: "security",
            title: `Unauthorized Door Opening (Simulated)`,
            message: `Reed switch triggered open without valid OTP unlock token on ${transport.transport_code}.`
          });
        }
      } else if (eventType === "door_closed") {
        revokeUnlockTokens(db, transport.id);
        details = "[SIMULATED] Reed switch reported door_closed; unlock authorization cleared";
      }

      db.execute(
        `INSERT INTO access_logs (transport_id, device_id, event_type, success, details, actor_user_id, source_ip)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [transport.id, transport.device_id, recordedEventType, success, details, req.user?.id || null, req.ip || "127.0.0.1"]
      );
      res.status(201).json({ simulated: true, recordedEventType, success: Boolean(success) });
    }
  );

  router.get("/:transportId/logs", requireAuth, (req, res) => {
    const transportId = parsePositiveIntId(req.params.transportId);
    if (!transportId) {
      return res.status(400).json({ error: { code: "INVALID_ID", message: "Valid transport ID is required." } });
    }
    const transport = db.queryOne("SELECT * FROM transports WHERE id = ?", [transportId]);
    if (!transport) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Transport not found." } });
    }
    if (!canAccessTransport(db, req.user, transport)) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied for this transport." } });
    }

    const logs = db.queryAll(
      "SELECT * FROM access_logs WHERE transport_id = ? ORDER BY id DESC LIMIT 50",
      [transportId]
    );
    res.json({ logs });
  });

  return router;
}
