import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { translateSqlAndParams, translateDdl, translateSqlPostgres } from "./db";

describe("PostgreSQL Database Wrapper & Translation", () => {
  describe("translateSqlAndParams", () => {
    it("should translate positional parameters from ? to $n", () => {
      const sql = "SELECT * FROM streams WHERE sender = ? AND recipient = ?";
      const params = ["alice", "bob"];
      const res = translateSqlAndParams(sql, params);
      expect(res.sql).toBe("SELECT * FROM streams WHERE sender = $1 AND recipient = $2");
      expect(res.params).toEqual(["alice", "bob"]);
    });

    it("should handle empty or null params", () => {
      const sql = "SELECT * FROM streams";
      const res = translateSqlAndParams(sql, null);
      expect(res.sql).toBe("SELECT * FROM streams");
      expect(res.params).toEqual([]);
    });

    it("should translate named parameters from @name to $n", () => {
      const sql = "INSERT INTO streams (id, sender) VALUES (@id, @sender)";
      const paramsObj = { id: "123", sender: "alice" };
      const res = translateSqlAndParams(sql, paramsObj);
      expect(res.sql).toBe("INSERT INTO streams (id, sender) VALUES ($1, $2)");
      expect(res.params).toEqual(["123", "alice"]);
    });

    it("should reuse the same placeholder for identical named parameters", () => {
      const sql = "SELECT * FROM streams WHERE sender = @user OR recipient = @user";
      const paramsObj = { user: "alice" };
      const res = translateSqlAndParams(sql, paramsObj);
      expect(res.sql).toBe("SELECT * FROM streams WHERE sender = $1 OR recipient = $1");
      expect(res.params).toEqual(["alice"]);
    });

    it("should not translate parameters inside quotes", () => {
      const sql = "SELECT * FROM streams WHERE label = 'User @admin' AND sender = @user";
      const paramsObj = { user: "alice" };
      const res = translateSqlAndParams(sql, paramsObj);
      expect(res.sql).toBe("SELECT * FROM streams WHERE label = 'User @admin' AND sender = $1");
      expect(res.params).toEqual(["alice"]);
    });
  });

  describe("translateDdl", () => {
    beforeEach(() => {
      process.env.DATABASE_URL = "postgres://localhost:5432/test";
    });

    afterEach(() => {
      delete process.env.DATABASE_URL;
    });

    it("should ignore virtual FTS tables", () => {
      const ddl = "CREATE TABLE normal (id TEXT); CREATE VIRTUAL TABLE streams_fts USING fts5(stream_id);";
      const res = translateDdl(ddl);
      expect(res).not.toContain("CREATE VIRTUAL TABLE");
      expect(res).not.toContain("streams_fts");
      expect(res).toContain("CREATE TABLE normal (id TEXT);");
    });

    it("should convert INTEGER PRIMARY KEY AUTOINCREMENT to SERIAL PRIMARY KEY", () => {
      const ddl = "CREATE TABLE test (id INTEGER PRIMARY KEY AUTOINCREMENT, val INTEGER);";
      const res = translateDdl(ddl);
      expect(res).toBe("CREATE TABLE test (id SERIAL PRIMARY KEY, val BIGINT);");
    });

    it("should convert REAL to DOUBLE PRECISION", () => {
      const ddl = "CREATE TABLE test (val REAL);";
      const res = translateDdl(ddl);
      expect(res).toBe("CREATE TABLE test (val DOUBLE PRECISION);");
    });
  });

  describe("translateSqlPostgres", () => {
    it("should translate INSERT OR IGNORE INTO stream_events with ON CONFLICT", () => {
      const sql = "INSERT OR IGNORE INTO stream_events (stream_id, event_type, ledger_sequence) VALUES (1, 'created', 10)";
      const res = translateSqlPostgres(sql);
      expect(res).toBe("INSERT INTO stream_events (stream_id, event_type, ledger_sequence) VALUES (1, 'created', 10) ON CONFLICT (stream_id, event_type, ledger_sequence) WHERE ledger_sequence IS NOT NULL DO NOTHING");
    });

    it("should translate INSERT OR IGNORE INTO allowed_assets with ON CONFLICT", () => {
      const sql = "INSERT OR IGNORE INTO allowed_assets (code) VALUES ('USDC')";
      const res = translateSqlPostgres(sql);
      expect(res).toBe("INSERT INTO allowed_assets (code) VALUES ('USDC') ON CONFLICT (code) DO NOTHING");
    });
  });
});
