import express from "express";
import { attachUserIfPresent } from "../middleware/auth.js";
import { createAuthRouter } from "../modules/auth/auth.routes.js";
import { createHospitalsRouter } from "../modules/hospitals/hospitals.routes.js";
import { createBloodBanksRouter } from "../modules/blood-banks/bloodBanks.routes.js";
import { createInventoryRouter } from "../modules/blood-banks/inventory.routes.js";
import { createBloodRequestsRouter } from "../modules/blood-requests/bloodRequests.routes.js";
import { createTransportRouter } from "../modules/transport/transport.routes.js";
import { createDevicesRouter } from "../modules/devices/devices.routes.js";
import {
  createSensorsRouter,
  createTemperatureRouter,
  createGpsRouter
} from "../modules/telemetry/telemetry.routes.js";
import { createOtpRouter, createAccessRouter } from "../modules/otp-access/otpAccess.routes.js";
import { createAlertsRouter } from "../modules/alerts/alerts.routes.js";
import { createAdminRouter } from "../modules/admin/admin.routes.js";
import { createEmergencyRouter } from "../modules/emergency/emergency.routes.js";
import { openApiSpec } from "../docs/openapi.js";
import { config } from "../config/env.js";

export function createV1Router(db) {
  const router = express.Router();

  router.use(attachUserIfPresent(db));

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      version: "v1",
      simulationMode: config.simulationMode,
      timestamp: new Date().toISOString()
    });
  });

  router.get("/docs", (_req, res) => {
    res.json(openApiSpec);
  });

  router.use("/auth", createAuthRouter(db));
  router.use("/hospitals", createHospitalsRouter(db));
  router.use("/blood-banks", createBloodBanksRouter(db));
  router.use("/inventory", createInventoryRouter(db));
  router.use("/blood-requests", createBloodRequestsRouter(db));
  router.use("/transport", createTransportRouter(db));
  router.use("/devices", createDevicesRouter(db));
  router.use("/sensors", createSensorsRouter(db));
  router.use("/temperature", createTemperatureRouter(db));
  router.use("/gps", createGpsRouter(db));
  router.use("/otp", createOtpRouter(db));
  router.use("/access", createAccessRouter(db));
  router.use("/alerts", createAlertsRouter(db));
  router.use("/admin", createAdminRouter(db));
  router.use("/emergency-requests", createEmergencyRouter(db));

  return router;
}
