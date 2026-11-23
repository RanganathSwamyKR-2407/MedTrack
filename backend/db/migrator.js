import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, "migrations");

export function runMigrations(db, migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  db.execRaw(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    db.queryAll("SELECT version FROM schema_migrations").map((row) => row.version)
  );

  const newlyApplied = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    db.transaction(() => {
      db.execRaw(sql);
      db.execute("INSERT INTO schema_migrations (version) VALUES (?)", [file]);
    });
    newlyApplied.push(file);
  }

  return newlyApplied;
}
