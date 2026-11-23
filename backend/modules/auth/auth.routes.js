import express from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
import { validateBody } from "../../middleware/validate.js";
import { requireAuth, signAuthToken } from "../../middleware/auth.js";
import { createRateLimiter } from "../../middleware/rateLimit.js";
import { recordAudit } from "../../utils/audit.js";
import { config } from "../../config/env.js";
import { parseUtcMs } from "../../utils/time.js";
import { notificationService } from "../../services/notificationService.js";

const registerSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email(),
  phone: z.string().regex(/^[0-9+\-\s]{10,15}$/, "Enter a valid 10-15 digit phone number"),
  role: z.enum(["patient", "hospital", "blood_bank"]),
  password: z.string().min(6).max(128)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const verifyContactSchema = z.object({
  channel: z.enum(["email", "phone"]),
  code: z.string().min(4).max(12).optional()
});

const requestResetSchema = z.object({
  email: z.string().email()
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
  token: z.string().min(6).max(128),
  newPassword: z.string().min(6).max(128)
});

function sanitizeUser(user) {
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    emailVerified: Boolean(user.email_verified),
    phoneVerified: Boolean(user.phone_verified),
    status: user.status
  };
}

export function createAuthRouter(db) {
  const router = express.Router();
  const authLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 25 });

  router.post("/register", authLimiter, validateBody(registerSchema), async (req, res) => {
    const data = req.validatedBody;
    const email = data.email.trim().toLowerCase();

    const existing = db.queryOne("SELECT id FROM users WHERE email = ?", [email]);
    if (existing) {
      return res.status(409).json({
        error: { code: "EMAIL_EXISTS", message: "An account with this email already exists." }
      });
    }

    const passwordHash = bcrypt.hashSync(data.password, 10);
    const verificationCode = String(crypto.randomInt(100000, 1000000));
    const verificationHash = crypto.createHash("sha256").update(verificationCode).digest("hex");

    const result = db.execute(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, verification_code_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.firstName.trim(),
        data.lastName.trim(),
        email,
        data.phone.trim(),
        passwordHash,
        data.role,
        verificationHash
      ]
    );

    const user = db.queryOne("SELECT * FROM users WHERE id = ?", [result.lastInsertRowid]);
    const token = signAuthToken(user);

    await notificationService.sendOtpNotification({
      recipientContact: email,
      transportCode: "ACCOUNT-VERIFY",
      expiresInSeconds: 900,
      otpPreviewForChannel: verificationCode
    });

    recordAudit(db, {
      actorUserId: user.id,
      actorRole: user.role,
      action: "user.registered",
      entityType: "user",
      entityId: user.id,
      ipAddress: req.ip
    });

    res.status(201).json({
      token,
      user: sanitizeUser(user),
      verificationPending: true,
      ...(config.simulationMode ? { simulationVerificationCode: verificationCode } : {})
    });
  });

  router.post("/login", authLimiter, validateBody(loginSchema), (req, res) => {
    const { email, password } = req.validatedBody;
    const normalizedEmail = email.trim().toLowerCase();

    const user = db.queryOne("SELECT * FROM users WHERE email = ?", [normalizedEmail]);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({
        error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." }
      });
    }

    if (user.status !== "active") {
      return res.status(403).json({
        error: { code: "ACCOUNT_SUSPENDED", message: "Account is suspended. Contact administrator." }
      });
    }

    const token = signAuthToken(user);
    const hospital =
      user.role === "hospital"
        ? db.queryOne("SELECT id, name, verification_status FROM hospitals WHERE user_id = ?", [user.id])
        : null;
    const bloodBank =
      user.role === "blood_bank"
        ? db.queryOne("SELECT id, name, verification_status FROM blood_banks WHERE user_id = ?", [user.id])
        : null;

    recordAudit(db, {
      actorUserId: user.id,
      actorRole: user.role,
      action: "user.login",
      entityType: "user",
      entityId: user.id,
      ipAddress: req.ip
    });

    res.json({
      token,
      user: sanitizeUser(user),
      facility: hospital || bloodBank || null
    });
  });

  router.get("/me", requireAuth, (req, res) => {
    const hospital =
      req.user.role === "hospital"
        ? db.queryOne("SELECT * FROM hospitals WHERE user_id = ?", [req.user.id])
        : null;
    const bloodBank =
      req.user.role === "blood_bank"
        ? db.queryOne("SELECT * FROM blood_banks WHERE user_id = ?", [req.user.id])
        : null;

    res.json({
      user: sanitizeUser(req.user),
      facility: hospital || bloodBank || null
    });
  });

  router.post("/verify-contact", authLimiter, requireAuth, validateBody(verifyContactSchema), async (req, res) => {
    const { channel, code } = req.validatedBody;
    const user = db.queryOne("SELECT * FROM users WHERE id = ?", [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found." } });
    }

    if (!code) {
      const freshCode = String(crypto.randomInt(100000, 1000000));
      const freshHash = crypto.createHash("sha256").update(freshCode).digest("hex");
      db.execute("UPDATE users SET verification_code_hash = ?, updated_at = datetime('now') WHERE id = ?", [
        freshHash,
        user.id
      ]);
      const recipientContact = channel === "email" ? user.email : user.phone;
      await notificationService.sendOtpNotification({
        recipientContact,
        transportCode: "CONTACT-VERIFY",
        expiresInSeconds: 900,
        otpPreviewForChannel: freshCode
      });
      return res.json({
        sent: true,
        channel,
        message: `Verification code dispatched to ${recipientContact}.`,
        ...(config.simulationMode ? { simulationVerificationCode: freshCode } : {})
      });
    }

    if (!user.verification_code_hash) {
      return res.status(400).json({
        error: { code: "NO_PENDING_VERIFICATION", message: "No verification code pending. Request a new code." }
      });
    }

    const providedHash = Buffer.from(
      crypto.createHash("sha256").update(code.trim()).digest("hex"),
      "hex"
    );
    const storedHash = Buffer.from(user.verification_code_hash, "hex");
    if (providedHash.length !== storedHash.length || !crypto.timingSafeEqual(providedHash, storedHash)) {
      return res.status(400).json({
        error: { code: "INVALID_CODE", message: "Verification code is invalid." }
      });
    }

    const col = channel === "email" ? "email_verified" : "phone_verified";
    db.execute(`UPDATE users SET ${col} = 1, updated_at = datetime('now') WHERE id = ?`, [req.user.id]);
    const updatedUser = db.queryOne("SELECT * FROM users WHERE id = ?", [req.user.id]);
    res.json({ verified: true, channel, user: sanitizeUser(updatedUser) });
  });

  router.post("/request-password-reset", authLimiter, validateBody(requestResetSchema), async (req, res) => {
    const email = req.validatedBody.email.trim().toLowerCase();
    const user = db.queryOne("SELECT id, email, status FROM users WHERE email = ?", [email]);

    if (!user || user.status !== "active") {
      return res.json({
        ok: true,
        message: "If an active account exists for this email, a reset token has been generated."
      });
    }

    const resetToken = String(crypto.randomInt(100000, 1000000));
    const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    db.transaction(() => {
      db.execute("UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL", [
        user.id
      ]);
      db.execute(
        "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
        [user.id, tokenHash, expiresAt]
      );
      recordAudit(db, {
        actorUserId: user.id,
        actorRole: "user",
        action: "user.password_reset_requested",
        entityType: "user",
        entityId: user.id,
        ipAddress: req.ip
      });
    });

    await notificationService.sendOtpNotification({
      recipientContact: email,
      transportCode: "PASSWORD-RESET",
      expiresInSeconds: 900,
      otpPreviewForChannel: resetToken
    });

    res.json({
      ok: true,
      message: "If an active account exists for this email, a reset token has been generated.",
      ...(config.simulationMode ? { simulationResetToken: resetToken } : {})
    });
  });

  router.post("/reset-password", authLimiter, validateBody(resetPasswordSchema), (req, res) => {
    const { email, token, newPassword } = req.validatedBody;
    const normalizedEmail = email.trim().toLowerCase();
    const user = db.queryOne("SELECT * FROM users WHERE email = ?", [normalizedEmail]);
    if (!user) {
      return res.status(400).json({ error: { code: "INVALID_RESET", message: "Invalid email or reset token." } });
    }

    const resetRow = db.queryOne(
      "SELECT * FROM password_resets WHERE user_id = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1",
      [user.id]
    );
    if (!resetRow || parseUtcMs(resetRow.expires_at) < Date.now()) {
      return res.status(400).json({
        error: { code: "RESET_EXPIRED", message: "Reset token is missing or expired." }
      });
    }

    const providedHash = Buffer.from(crypto.createHash("sha256").update(token.trim()).digest("hex"), "hex");
    const storedHash = Buffer.from(resetRow.token_hash, "hex");
    if (providedHash.length !== storedHash.length || !crypto.timingSafeEqual(providedHash, storedHash)) {
      return res.status(400).json({ error: { code: "INVALID_RESET", message: "Invalid email or reset token." } });
    }

    const newPasswordHash = bcrypt.hashSync(newPassword, 10);
    db.transaction(() => {
      db.execute("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?", [
        newPasswordHash,
        user.id
      ]);
      db.execute("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?", [resetRow.id]);
      recordAudit(db, {
        actorUserId: user.id,
        actorRole: user.role,
        action: "user.password_reset_completed",
        entityType: "user",
        entityId: user.id,
        ipAddress: req.ip
      });
    });

    res.json({ ok: true, message: "Password updated successfully. You may now sign in." });
  });

  router.post("/logout", requireAuth, (req, res) => {
    recordAudit(db, {
      actorUserId: req.user.id,
      actorRole: req.user.role,
      action: "user.logout",
      entityType: "user",
      entityId: req.user.id,
      ipAddress: req.ip
    });
    res.json({ message: "Logged out." });
  });

  return router;
}
