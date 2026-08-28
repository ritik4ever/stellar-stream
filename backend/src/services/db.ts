import Database from "better-sqlite3";
import path from "path";
import { runMigrations } from "./migrations";

const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, "..", "..", "data", "streams.db");

let db: any;

export function getDb(): any {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

export function isPostgres(): boolean {
  return !!process.env.DATABASE_URL;
}

// Inline worker code for synchronous PostgreSQL access
const pgWorkerCode = `
const { workerData } = require("worker_threads");
const { Client } = require("pg");

async function run() {
  const client = new Client({ connectionString: workerData.connectionString });
  await client.connect();

  const state = workerData.state;
  const buffer = workerData.buffer;

  while (true) {
    // Wait for state[0] to become 1 (query pending)
    Atomics.wait(state, 0, 0); // Wait while state[0] is 0
    if (state[0] === 1) {
      const queryLen = state[1];
      const decoder = new TextDecoder();
      const queryStr = decoder.decode(buffer.subarray(0, queryLen));
      const { sql, params } = JSON.parse(queryStr);

      try {
        const res = await client.query(sql, params);
        const resultStr = JSON.stringify({ rows: res.rows, rowCount: res.rowCount });
        const encoder = new TextEncoder();
        const resultBytes = encoder.encode(resultStr);
        buffer.set(resultBytes);
        state[1] = resultBytes.length;
        state[0] = 2; // Success
      } catch (err) {
        const resultStr = JSON.stringify({ error: err.message });
        const encoder = new TextEncoder();
        const resultBytes = encoder.encode(resultStr);
        buffer.set(resultBytes);
        state[1] = resultBytes.length;
        state[0] = 3; // Error
      }

      Atomics.notify(state, 0);
    }
  }
}

run().catch(err => {
  console.error("Postgres Worker Error:", err);
  process.exit(1);
});
`;

export function translateSqlAndParams(sql: string, paramsObj: any): { sql: string; params: any[] } {
  if (!paramsObj || Array.isArray(paramsObj)) {
    let paramIndex = 1;
    let inQuote = false;
    let quoteChar = "";
    let pgSql = "";
    for (let i = 0; i < sql.length; i++) {
      const char = sql[i];
      if ((char === "'" || char === '"') && sql[i - 1] !== "\\") {
        if (!inQuote) {
          inQuote = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuote = false;
        }
        pgSql += char;
      } else if (char === "?" && !inQuote) {
        pgSql += `$${paramIndex++}`;
      } else {
        pgSql += char;
      }
    }
    return { sql: pgSql, params: paramsObj || [] };
  }

  const params: any[] = [];
  const nameToPos = new Map<string, string>();
  let paramIndex = 1;

  let inQuote = false;
  let quoteChar = "";
  let pgSql = "";
  let i = 0;
  while (i < sql.length) {
    const char = sql[i];
    if ((char === "'" || char === '"') && sql[i - 1] !== "\\") {
      if (!inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuote = false;
      }
      pgSql += char;
      i++;
    } else if (char === "@" && !inQuote) {
      let name = "";
      i++; // skip '@'
      while (i < sql.length && /[a-zA-Z0-9_]/.test(sql[i])) {
        name += sql[i];
        i++;
      }
      if (!name) {
        pgSql += "@";
        continue;
      }
      let placeholder = nameToPos.get(name);
      if (!placeholder) {
        placeholder = `$${paramIndex++}`;
        nameToPos.set(name, placeholder);
        let val = paramsObj[name];
        if (val === undefined) {
          val = null;
        }
        params.push(val);
      }
      pgSql += placeholder;
    } else {
      pgSql += char;
      i++;
    }
  }

  return { sql: pgSql, params };
}

export function translateDdl(sql: string): string {
  if (!isPostgres()) return sql;

  const statements = sql.split(";");
  const pgStatements = [];

  for (let stmt of statements) {
    stmt = stmt.trim();
    if (!stmt) continue;

    if (stmt.toUpperCase().includes("CREATE VIRTUAL TABLE") || stmt.toUpperCase().includes("STREAMS_FTS")) {
      continue;
    }

    let pgStmt = stmt;
    
    // Replace SQLite-specific AUTOINCREMENT keys
    pgStmt = pgStmt.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, "SERIAL PRIMARY KEY");
    pgStmt = pgStmt.replace(/BIGINT\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, "SERIAL PRIMARY KEY");
    
    // Replace types
    pgStmt = pgStmt.replace(/\bINTEGER\b/g, "BIGINT");
    pgStmt = pgStmt.replace(/\bREAL\b/g, "DOUBLE PRECISION");

    pgStatements.push(pgStmt);
  }

  return pgStatements.join(";\n") + ";";
}

export function translateSqlPostgres(sql: string): string {
  let res = sql;
  
  if (res.includes("INSERT OR IGNORE INTO stream_events")) {
    res = res.replace("INSERT OR IGNORE INTO stream_events", "INSERT INTO stream_events");
    // Ensure ON CONFLICT goes at the end of the query string.
    res += " ON CONFLICT (stream_id, event_type, ledger_sequence) WHERE ledger_sequence IS NOT NULL DO NOTHING";
  }
  
  if (res.includes("INSERT OR IGNORE INTO allowed_assets")) {
    res = res.replace("INSERT OR IGNORE INTO allowed_assets", "INSERT INTO allowed_assets");
    res += " ON CONFLICT (code) DO NOTHING";
  }

  return res;
}

class PostgresDatabase {
  private state: Int32Array;
  private buffer: Uint8Array;
  private worker: any;

  constructor(connectionString: string) {
    const { Worker } = require("worker_threads");

    // 20MB SharedArrayBuffer
    const sharedBuffer = new SharedArrayBuffer(20 * 1024 * 1024);
    this.state = new Int32Array(sharedBuffer, 0, 4);
    this.buffer = new Uint8Array(sharedBuffer, 16);

    this.state[0] = 0; // idle

    this.worker = new Worker(pgWorkerCode, {
      eval: true,
      workerData: {
        connectionString,
        state: this.state,
        buffer: this.buffer,
      },
    });

    this.worker.unref();
  }

  private querySync(sql: string, params: any = []): any {
    const translated = translateSqlAndParams(sql, params);
    let postgresSql = translateSqlPostgres(translated.sql);
    postgresSql = translateDdl(postgresSql);

    if (!postgresSql.trim()) {
      return { rows: [], rowCount: 0 };
    }

    const queryStr = JSON.stringify({ sql: postgresSql, params: translated.params });
    const encoder = new TextEncoder();
    const queryBytes = encoder.encode(queryStr);

    if (queryBytes.length > this.buffer.length) {
      throw new Error("Query too large for SharedArrayBuffer");
    }

    this.buffer.set(queryBytes);
    this.state[1] = queryBytes.length;
    this.state[0] = 1; // pending

    Atomics.notify(this.state, 0);
    Atomics.wait(this.state, 0, 1);

    const resultLen = this.state[1];
    const decoder = new TextDecoder();
    const resultStr = decoder.decode(this.buffer.subarray(0, resultLen));
    const result = JSON.parse(resultStr);

    this.state[0] = 0; // idle

    if (result.error) {
      throw new Error(`Postgres query error: ${result.error}\nQuery: ${postgresSql}\nParams: ${JSON.stringify(translated.params)}`);
    }

    return result;
  }

  public exec(sql: string): void {
    this.querySync(sql);
  }

  public prepare(sql: string): any {
    const dbInstance = this;
    return {
      run(...params: any[]): any {
        const paramObj = params.length === 1 && typeof params[0] === "object" && params[0] !== null && !Array.isArray(params[0]) ? params[0] : params;
        const res = dbInstance.querySync(sql, paramObj);
        return {
          changes: res.rowCount,
          lastInsertRowid: 0,
        };
      },
      get(...params: any[]): any {
        const paramObj = params.length === 1 && typeof params[0] === "object" && params[0] !== null && !Array.isArray(params[0]) ? params[0] : params;
        const res = dbInstance.querySync(sql, paramObj);
        return res.rows[0] || undefined;
      },
      all(...params: any[]): any {
        const paramObj = params.length === 1 && typeof params[0] === "object" && params[0] !== null && !Array.isArray(params[0]) ? params[0] : params;
        const res = dbInstance.querySync(sql, paramObj);
        return res.rows;
      },
    };
  }

  public transaction(fn: Function): any {
    const dbInstance = this;
    return (...args: any[]) => {
      dbInstance.exec("BEGIN");
      try {
        const result = fn(...args);
        dbInstance.exec("COMMIT");
        return result;
      } catch (error) {
        dbInstance.exec("ROLLBACK");
        throw error;
      }
    };
  }

  public pragma(stmt: string): any {
    return [];
  }

  public close(): void {
    if (this.worker) {
      this.worker.terminate();
    }
  }
}

export function initDb(): void {
  if (isPostgres()) {
    db = new PostgresDatabase(process.env.DATABASE_URL!);
  } else {
    const dir = path.dirname(DB_PATH);
    const fs = require("fs");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("synchronous = NORMAL");
    db.pragma("busy_timeout = 5000");
    db.pragma("cache_size = -64000");
  }

  runMigrations(db);
  ensureAllowedAssetsTable(db);
  seedAllowedAssets(db);
}

// ── allowed assets allowlist ──────────────────────────────────────────────────

function ensureAllowedAssetsTable(db: any): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS allowed_assets (
      code TEXT PRIMARY KEY
    );
  `);
}

/**
 * Seeds the allowlist from the ALLOWED_ASSETS env var on first init.
 * Existing rows are preserved so admin-added assets survive restarts.
 */
function seedAllowedAssets(db: any): void {
  const configured = (process.env.ALLOWED_ASSETS || "USDC,XLM")
    .split(",")
    .map((asset) => asset.trim().toUpperCase())
    .filter((asset) => asset.length > 0);

  const existing = (
    db.prepare("SELECT COUNT(*) AS c FROM allowed_assets").get() as { c: number }
  ).c;
  if (existing > 0) {
    return;
  }

  const insert = db.prepare(
    "INSERT OR IGNORE INTO allowed_assets (code) VALUES (@code)",
  );
  db.transaction(() => {
    for (const code of configured) {
      insert.run({ code });
    }
  })();
}

export function getAllowedAssets(): string[] {
  // Return in insertion order (matches the ALLOWED_ASSETS env order and the
  // order assets were added via the admin API). The table uses an implicit
  // rowid since it is declared with a TEXT PRIMARY KEY.
  const rows = getDb()
    .prepare("SELECT code FROM allowed_assets ORDER BY rowid")
    .all() as Array<{ code: string }>;
  return rows.map((row) => row.code);
}

export function addAllowedAsset(code: string): void {
  getDb()
    .prepare("INSERT OR IGNORE INTO allowed_assets (code) VALUES (@code)")
    .run({ code: code.trim().toUpperCase() });
}

export function removeAllowedAsset(code: string): void {
  getDb()
    .prepare("DELETE FROM allowed_assets WHERE code = @code")
    .run({ code: code.trim().toUpperCase() });
}

// ── full-text search over streams ─────────────────────────────────────────────

/**
 * Creates the FTS5 index on demand. Skipped on PostgreSQL (no FTS5 virtual
 * tables), where `searchStreamsFts` falls back to a LIKE query.
 */
function ensureFtsTable(db: any): void {
  if (isPostgres()) {
    return;
  }
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS streams_fts USING fts5(
      id UNINDEXED,
      sender,
      recipient,
      asset_code
    );
  `);
}

/**
 * Keeps the FTS index in sync when a stream is created or updated.
 * Called by the stream store on every upsert.
 */
export function syncFtsIndex(
  id: string,
  sender: string,
  recipient: string,
  assetCode: string,
): void {
  if (isPostgres()) {
    return;
  }
  try {
    const db = getDb();
    ensureFtsTable(db);
    db.prepare(
      `INSERT OR REPLACE INTO streams_fts (id, sender, recipient, asset_code)
       VALUES (@id, @sender, @recipient, @assetCode)`,
    ).run({ id, sender, recipient, assetCode });
  } catch (err) {
    // FTS sync must never break stream writes; search degrades gracefully.
    console.error("failed to sync FTS index:", err);
  }
}

/**
 * Returns stream IDs whose indexed fields match the query.
 * Uses FTS5 on SQLite; falls back to a case-insensitive LIKE scan on
 * PostgreSQL (and on SQLite builds without the FTS5 module).
 */
export function searchStreamsFts(query: string): string[] {
  const db = getDb();
  const term = query.trim().toLowerCase();
  if (!term) {
    return [];
  }

  if (!isPostgres()) {
    try {
      ensureFtsTable(db);
      // Quote as a phrase so FTS5 treats the input as a literal search term.
      const escaped = '"' + term.replace(/"/g, '""') + '"';
      const rows = db
        .prepare(
          "SELECT id FROM streams_fts WHERE streams_fts MATCH @q ORDER BY rank LIMIT 50",
        )
        .all({ q: escaped }) as Array<{ id: string }>;
      if (rows.length > 0) {
        return rows.map((row) => row.id);
      }
      // If the FTS index is empty (e.g. table just created), fall through
      // to the LIKE scan so existing streams are still searchable.
      const ftsCount = (
        db.prepare("SELECT COUNT(*) AS c FROM streams_fts").get() as { c: number }
      ).c;
      if (ftsCount > 0) {
        return [];
      }
    } catch {
      // FTS5 unavailable → fall through to the LIKE scan.
    }
  }

  const like = `%${term}%`;
  const rows = db
    .prepare(
      `SELECT id FROM streams
       WHERE lower(id) LIKE @q OR lower(sender) LIKE @q
          OR lower(recipient) LIKE @q OR lower(asset_code) LIKE @q
       ORDER BY id LIMIT 50`,
    )
    .all({ q: like }) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}
