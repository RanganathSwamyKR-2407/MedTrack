import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { config } from "../config/env.js";
import { hashApiKey } from "../db/seed.js";

export function signAuthToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role
    },
    config.auth.jwtSecret,
    { expiresIn: config.auth.jwtExpiresIn }
  );
}

function extractBearerToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  return null;
}

export function attachUserIfPresent(db) {
  return (req, _res, next) => {
    const token = extractBearerToken(req);
    if (!token) {
      req.user = null;
      return next();
    }
    try {
      const payload = jwt.verify(token, config.auth.jwtSecret);
      const user = db.queryOne(
        "SELECT id, first_name, last_name, email, phone, role, email_verified, phone_verified, status FROM users WHERE id = ?",
        [payload.sub]
      );
      if (user && user.status === "active") {
        req.user = user;
      } else {
        req.user = null;
      }
    } catch {
      req.user = null;
    }
    next();
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Authentication token is required or invalid." }
    });
  }
  next();
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: { code: "UNAUTHORIZED", message: "Authentication required." }
      });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: `Access denied. Required role: ${allowedRoles.join(" or ")}.`
        }
      });
    }
    next();
  };
}

/**
 * Authenticates IoT hardware devices (ESP32) using X-Device-Id and X-Device-Key headers
 * compared with timing-safe equality against stored SHA-256 hashes.
 */
export function requireDeviceAuth(db) {
  return (req, res, next) => {
    const deviceUid = req.headers["x-device-id"];
    const rawKey = req.headers["x-device-key"];

    if (!deviceUid || !rawKey) {
      return res.status(401).json({
        error: {
          code: "DEVICE_AUTH_REQUIRED",
          message: "Missing X-Device-Id or X-Device-Key headers."
        }
      });
    }

    const device = db.queryOne("SELECT * FROM devices WHERE device_uid = ?", [String(deviceUid)]);
    if (!device) {
      return res.status(401).json({
        error: { code: "DEVICE_UNAUTHORIZED", message: "Unknown device identifier." }
      });
    }

    const providedHash = Buffer.from(hashApiKey(String(rawKey)), "hex");
    const storedHash = Buffer.from(device.api_key_hash, "hex");
    if (
      providedHash.length !== storedHash.length ||
      !crypto.timingSafeEqual(providedHash, storedHash)
    ) {
      return res.status(401).json({
        error: { code: "DEVICE_UNAUTHORIZED", message: "Invalid device credentials." }
      });
    }

    req.device = device;
    next();
  };
}
