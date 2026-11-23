import crypto from "node:crypto";
import { config } from "../../config/env.js";

/**
 * Generates a cryptographically secure 6-digit numeric OTP.
 */
export function generateSecureOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * Produces an HMAC-SHA256 digest of an OTP or unlock token so plaintext OTPs are never stored.
 */
export function hashOtpSecret(value) {
  return crypto
    .createHmac("sha256", config.auth.otpHmacSecret)
    .update(String(value))
    .digest("hex");
}

export function timingSafeHexCompare(hexA, hexB) {
  if (!hexA || !hexB) return false;
  const bufA = Buffer.from(hexA, "hex");
  const bufB = Buffer.from(hexB, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
