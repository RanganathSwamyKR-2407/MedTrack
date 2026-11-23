import crypto from "node:crypto";

// Ephemeral fallback secrets for local development only if env vars are omitted.
// In production, JWT_SECRET and OTP_HMAC_SECRET must be set via environment variables.
const devJwtFallback = crypto.randomBytes(32).toString("hex");
const devOtpFallback = crypto.randomBytes(32).toString("hex");

export const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || "0.0.0.0",
  nodeEnv: process.env.NODE_ENV || "development",

  db: {
    driver: process.env.DB_DRIVER || "sqlite",
    sqlitePath: process.env.DB_PATH || "./data/medtrack.sqlite",
    databaseUrl: process.env.DATABASE_URL || ""
  },

  auth: {
    jwtSecret: process.env.JWT_SECRET || devJwtFallback,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "12h",
    otpHmacSecret: process.env.OTP_HMAC_SECRET || devOtpFallback,
    usesEphemeralSecret: !process.env.JWT_SECRET
  },

  otp: {
    ttlSeconds: Number(process.env.OTP_TTL_SECONDS) || 300,
    maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS) || 5,
    lockoutSeconds: Number(process.env.OTP_LOCKOUT_SECONDS) || 900,
    unlockTokenTtlSeconds: Number(process.env.UNLOCK_TOKEN_TTL_SECONDS) || 60
  },

  telemetry: {
    tempMinC: Number(process.env.TEMP_MIN_C ?? 4.0),
    tempMaxC: Number(process.env.TEMP_MAX_C ?? 8.0),
    tempHysteresisC: Number(process.env.TEMP_HYSTERESIS_C ?? 0.5),
    tempStaleSeconds: Number(process.env.TEMP_STALE_SECONDS) || 60,
    gpsStaleSeconds: Number(process.env.GPS_STALE_SECONDS) || 90,
    deviceOfflineSeconds: Number(process.env.DEVICE_OFFLINE_SECONDS) || 120
  },

  simulationMode: process.env.SIMULATION_MODE !== "false"
};

if (config.nodeEnv === "production" && config.auth.usesEphemeralSecret) {
  console.warn("[SECURITY WARNING] JWT_SECRET is not set in production environment.");
}
