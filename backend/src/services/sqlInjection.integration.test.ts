import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import path from "path";
import fs from "fs";
import { initDb, getDb } from "./db";
import {
  listStreamsByRecipient,
  listStreamsBySender,
  nowInSeconds,
} from "./streamStore";
import { recordEvent, getStreamHistory, getGlobalEvents, countAllEvents } from "./eventHistory";

/**
 * SQL injection audit for backend/src/services/db.ts and streamStore.ts /
 * eventHistory.ts query builders (issue #777).
 *
 * All queries in this codebase use parameterized statements (`?` / `@name`
 * bindings via better-sqlite3), so untrusted input is passed as bind
 * parameters, never spliced into the SQL string. These tests feed classic
 * SQLi payloads through user-controlled inputs (recipient/sender addresses,
 * stream IDs, actor names, event types) and assert:
 *   1. The payload is stored/matched as plain text, not executed as SQL.
 *   2. The database schema/data is left intact (no dropped tables, no
 *      unauthorized rows returned).
 */

const TEST_DB_PATH = path.join(__dirname, "..", "..", "data", "test-sql-injection.db");

const SQLI_PAYLOADS = [
  "' OR '1'='1",
  "'; DROP TABLE streams; --",
  "' UNION SELECT * FROM streams --",
  "\"; DELETE FROM streams WHERE '1'='1",
  "GABC'--",
  "1; DROP TABLE stream_events;",
];

function insertStream(id: string, sender: string, recipient: string): void {
  const db = getDb();
  const now = nowInSeconds();
  db.prepare(
    `INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at, paused_duration)
     VALUES (@id, @sender, @recipient, 'XLM', 1000, 3600, @now, @now, 0)`,
  ).run({ id, sender, recipient, now });
}

describe("SQL injection audit", () => {
  beforeAll(() => {
    process.env.DB_PATH = TEST_DB_PATH;
    initDb();
  });

  beforeEach(() => {
    const db = getDb();
    db.exec("DELETE FROM stream_events");
    db.exec("DELETE FROM streams");
  });

  afterAll(() => {
    const db = getDb();
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  it("treats injection payloads in recipient/sender addresses as plain text (listStreamsByRecipient/BySender)", () => {
    for (const payload of SQLI_PAYLOADS) {
      insertStream(`stream-${Buffer.from(payload).toString("hex").slice(0, 8)}`, "GSENDER", payload);
    }

    for (const payload of SQLI_PAYLOADS) {
      const bySender = listStreamsBySender(payload);
      const byRecipient = listStreamsByRecipient(payload);

      // No matches unless a row's sender/recipient literally equals the payload string.
      expect(bySender.every((s) => s.sender === payload)).toBe(true);
      expect(byRecipient.every((s) => s.recipient === payload)).toBe(true);
    }

    // The streams table must still exist and contain exactly the rows we inserted.
    const db = getDb();
    const count = db.prepare("SELECT COUNT(*) as count FROM streams").get() as { count: number };
    expect(count.count).toBe(SQLI_PAYLOADS.length);
  });

  it("does not allow injection via stream_id in getStreamHistory", () => {
    insertStream("legit-stream", "GSENDER", "GRECIPIENT");
    recordEvent("legit-stream", "created", nowInSeconds(), "GSENDER");

    for (const payload of SQLI_PAYLOADS) {
      const events = getStreamHistory(payload);
      expect(events).toEqual([]);
    }

    // Original event must be untouched.
    const remaining = getStreamHistory("legit-stream");
    expect(remaining).toHaveLength(1);
  });

  it("does not allow injection via actor field stored on events", () => {
    insertStream("actor-stream", "GSENDER", "GRECIPIENT");
    const payload = SQLI_PAYLOADS[1];
    recordEvent("actor-stream", "created", nowInSeconds(), payload);

    const events = getStreamHistory("actor-stream");
    expect(events).toHaveLength(1);
    expect(events[0].actor).toBe(payload);

    // Table still present and query-able after storing/retrieving the payload.
    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'streams'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("does not allow injection via streamId filter in getGlobalEvents/countAllEvents", () => {
    insertStream("global-stream", "GSENDER", "GRECIPIENT");
    recordEvent("global-stream", "created", nowInSeconds(), "GSENDER");

    for (const payload of SQLI_PAYLOADS) {
      expect(getGlobalEvents(50, 0, undefined, undefined, payload)).toEqual([]);
      expect(countAllEvents(undefined, payload)).toBe(0);
    }

    expect(countAllEvents()).toBe(1);
  });
});
