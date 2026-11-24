import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";
import { config } from "../config/env.js";

const require = createRequire(import.meta.url);

/**
 * DatabaseAdapter provides a driver-agnostic interface (queryAll, queryOne, execute, transaction)
 * backed by sql.js (SQLite) today, and structured to swap in PostgreSQL (pg.Pool) via DB_DRIVER=postgres.
 */
export class SqliteAdapter {
  constructor(sqlitePath) {
    this.sqlitePath = sqlitePath;
    this.db = null;
    this.inTransaction = false;
  }

  async init() {
    if (this.db) return this;

    const wasmDir = path.dirname(require.resolve("sql.js/dist/sql-wasm.wasm"));
    const SQL = await initSqlJs({
      locateFile: (file) => path.join(wasmDir, file)
    });

    const isMemory = this.sqlitePath === ":memory:";
    if (!isMemory && fs.existsSync(this.sqlitePath)) {
      const buffer = fs.readFileSync(this.sqlitePath);
      this.db = new SQL.Database(buffer);
    } else {
      if (!isMemory) {
        fs.mkdirSync(path.dirname(path.resolve(this.sqlitePath)), { recursive: true });
      }
      this.db = new SQL.Database();
    }

    this.db.run("PRAGMA foreign_keys = ON;");
    return this;
  }

  persist() {
    if (!this.db || this.sqlitePath === ":memory:" || this.inTransaction) {
      return;
    }
    const data = this.db.export();
    const resolved = path.resolve(this.sqlitePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    const tmpPath = `${resolved}.tmp`;
    fs.writeFileSync(tmpPath, Buffer.from(data));
    fs.renameSync(tmpPath, resolved);
  }

  queryAll(sql, params = []) {
    const safeParams = params.map((p) => (p === undefined ? null : p));
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(safeParams);
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  queryOne(sql, params = []) {
    const rows = this.queryAll(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  execute(sql, params = []) {
    const safeParams = params.map((p) => (p === undefined ? null : p));
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(safeParams);
      stmt.step();
    } finally {
      stmt.free();
    }
    const changes = this.db.getRowsModified();
    const lastInsertRow = this.queryOne("SELECT last_insert_rowid() AS id");
    this.persist();
    return {
      changes,
      lastInsertRowid: lastInsertRow ? Number(lastInsertRow.id) : null
    };
  }

  execRaw(sql) {
    this.db.exec(sql);
    this.persist();
  }

  transaction(fn) {
    if (this.inTransaction) {
      return fn(this);
    }
    this.inTransaction = true;
    this.db.run("BEGIN TRANSACTION;");
    try {
      const result = fn(this);
      this.db.run("COMMIT;");
      this.inTransaction = false;
      this.persist();
      return result;
    } catch (err) {
      this.db.run("ROLLBACK;");
      this.inTransaction = false;
      throw err;
    }
  }

  close() {
    if (this.db) {
      this.persist();
      this.db.close();
      this.db = null;
    }
  }
}

let activeAdapter = null;

export async function createDatabase(sqlitePath = config.db.sqlitePath) {
  if (config.db.driver === "postgres") {
    throw new Error(
      "PostgreSQL adapter selected (DB_DRIVER=postgres). Implement PostgresAdapter using pg.Pool with identical queryAll/queryOne/execute/transaction methods."
    );
  }
  const adapter = new SqliteAdapter(sqlitePath);
  await adapter.init();
  return adapter;
}

export async function getDb() {
  if (!activeAdapter) {
    activeAdapter = await createDatabase(config.db.sqlitePath);
  }
  return activeAdapter;
}

export function setActiveDb(adapter) {
  activeAdapter = adapter;
}
