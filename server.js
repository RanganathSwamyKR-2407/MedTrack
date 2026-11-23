import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import helmet from "helmet";
import cors from "cors";
import { config } from "./backend/config/env.js";
import { getDb, setActiveDb } from "./backend/db/adapter.js";
import { runMigrations } from "./backend/db/migrator.js";
import { seedDatabase } from "./backend/db/seed.js";
import { createV1Router } from "./backend/routes/v1.js";
import { apiNotFoundHandler, errorHandler } from "./backend/middleware/errorHandler.js";
import { syncDeviceOfflineAlerts } from "./backend/modules/devices/devices.routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(db) {
  const app = express();

  // Lightweight health check endpoint for Render and load balancers:
  // Registered before any parsing, security, database checks, or static routes to prevent timeouts.
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", service: "MedTrack" });
  });

  app.use(
    helmet({
      contentSecurityPolicy: false // Allow Leaflet CDN tiles/scripts and inline event handlers in existing static pages
    })
  );
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/v1", createV1Router(db));
  app.use("/api", apiNotFoundHandler);

  app.use(
    express.static(__dirname, {
      dotfiles: "ignore",
      extensions: ["html"]
    })
  );

  app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
  });

  app.use(errorHandler);
  return app;
}

export async function bootstrapServer() {
  const db = await getDb();
  setActiveDb(db);
  runMigrations(db);
  seedDatabase(db);
  syncDeviceOfflineAlerts(db);

  const monitorTimer = setInterval(() => {
    try {
      syncDeviceOfflineAlerts(db);
    } catch (err) {
      console.error("Device connectivity monitor error:", err.message);
    }
  }, 30_000);
  if (typeof monitorTimer.unref === "function") {
    monitorTimer.unref();
  }

  const port = Number(process.env.PORT) || config.port || 3000;
  const host = process.env.HOST || "0.0.0.0";
  const app = createApp(db);
  const server = app.listen(port, host, () => {
    console.log(`MedTrack India API & Frontend listening on http://${host}:${port}`);
  });
  return { app, db, server };
}

// Start server only when executed directly (not when imported by test runner)
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  bootstrapServer().catch((err) => {
    console.error("Failed to start MedTrack server:", err);
    process.exit(1);
  });
}
