import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { recordEventWithDb, getStreamHistory } from "./eventHistory";

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  initDb: vi.fn(),
}));

vi.mock("./db", () => dbMocks);

function createTestDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE stream_events (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id       TEXT NOT NULL,
      event_type      TEXT NOT NULL,
      ledger_sequence INTEGER,
      timestamp       INTEGER NOT NULL,
      actor           TEXT,
      amount          REAL,
      metadata        TEXT
    );
    CREATE UNIQUE INDEX idx_stream_events_dedup
      ON stream_events(stream_id, event_type, ledger_sequence)
      WHERE ledger_sequence IS NOT NULL;
  `);
  return db;
}

describe("eventHistory", () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
    dbMocks.getDb.mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  describe("recordEventWithDb basic operations", () => {
    it("inserts an event normally", () => {
      recordEventWithDb(db, "1", "created", 1000, "GSENDER", 100, undefined, 42);
      const rows = db.prepare("SELECT * FROM stream_events").all();
      expect(rows).toHaveLength(1);
    });

    it("silently ignores a duplicate (stream_id, event_type, ledger_sequence)", () => {
      recordEventWithDb(db, "1", "created", 1000, "GSENDER", 100, undefined, 42);
      recordEventWithDb(db, "1", "created", 1000, "GSENDER", 100, undefined, 42);

      const rows = db.prepare("SELECT * FROM stream_events").all();
      expect(rows).toHaveLength(1);
    });

    it("allows same event_type on different ledger sequences", () => {
      recordEventWithDb(db, "1", "claimed", 1000, "GRECIPIENT", 50, undefined, 10);
      recordEventWithDb(db, "1", "claimed", 2000, "GRECIPIENT", 50, undefined, 20);

      const rows = db.prepare("SELECT * FROM stream_events").all();
      expect(rows).toHaveLength(2);
    });

    it("allows events without ledger_sequence to coexist (reconciliation path)", () => {
      recordEventWithDb(db, "1", "created", 1000, "GSENDER", 100);
      recordEventWithDb(db, "1", "created", 1000, "GSENDER", 100);

      // NULL is not equal to NULL in SQLite unique index, so both rows are inserted
      const rows = db.prepare("SELECT * FROM stream_events").all();
      expect(rows).toHaveLength(2);
    });
  });

  describe("indexer restart deduplication", () => {
    it("produces no duplicate rows after reprocessing the same ledger range", () => {
      // Simulate first indexer run: ledger 5
      recordEventWithDb(db, "42", "created", 1000, "GSENDER", 500, undefined, 5);
      recordEventWithDb(db, "42", "claimed", 2000, "GRECIPIENT", 100, undefined, 6);

      // Simulate restart — same ledger range replayed
      recordEventWithDb(db, "42", "created", 1000, "GSENDER", 500, undefined, 5);
      recordEventWithDb(db, "42", "claimed", 2000, "GRECIPIENT", 100, undefined, 6);

      const rows = db.prepare("SELECT * FROM stream_events WHERE stream_id = '42'").all();
      expect(rows).toHaveLength(2);
    });
  });

  describe("recordEvent", () => {
    it("stores both events when two are recorded for the same stream", async () => {
      const { recordEvent, countStreamEvents, getStreamHistory } = await import(
        "./eventHistory"
      );

      recordEvent("stream-1", "created", 1000, "GACTOR1", 100);
      recordEvent("stream-1", "claimed", 2000, "GACTOR2", 50);

      expect(countStreamEvents("stream-1")).toBe(2);

      const history = getStreamHistory("stream-1", 20, 0, "asc");
      expect(history).toHaveLength(2);
      expect(history.map((e) => e.eventType)).toEqual(["created", "claimed"]);
    });

    it("stores duplicate event types for the same stream without deduping", async () => {
      const { recordEvent, countStreamEvents } = await import("./eventHistory");

      recordEvent("stream-2", "claimed", 1000, "GACTOR1", 25);
      recordEvent("stream-2", "claimed", 2000, "GACTOR1", 25);

      expect(countStreamEvents("stream-2")).toBe(2);
    });
  });

  describe("recordEventWithDb import tests", () => {
    it("inserts using the provided db handle", async () => {
      const { recordEventWithDb, getStreamHistory } = await import(
        "./eventHistory"
      );

      recordEventWithDb(db, "stream-3", "created", 500, "GACTOR3", 200, {
        note: "test",
      });

      const history = getStreamHistory("stream-3");
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        streamId: "stream-3",
        eventType: "created",
        timestamp: 500,
        actor: "GACTOR3",
        amount: 200,
        metadata: { note: "test" },
      });
    });
  });

  describe("getStreamHistory ordering", () => {
    it("returns events ascending by timestamp even when inserted out of order", async () => {
      const { recordEvent, getStreamHistory } = await import("./eventHistory");

      recordEvent("stream-4", "claimed", 3000);
      recordEvent("stream-4", "created", 1000);
      recordEvent("stream-4", "start_time_updated", 2000);
      recordEvent("stream-4", "canceled", 4000);

      const history = getStreamHistory("stream-4", 20, 0, "asc");

      expect(history.map((e) => e.timestamp)).toEqual([1000, 2000, 3000, 4000]);
      expect(history.map((e) => e.eventType)).toEqual([
        "created",
        "start_time_updated",
        "claimed",
        "canceled",
      ]);
    });

    it("breaks ties on equal timestamps by insertion order (id ASC)", async () => {
      const { recordEvent, getStreamHistory } = await import("./eventHistory");

      recordEvent("stream-5", "created", 1000, "first");
      recordEvent("stream-5", "claimed", 1000, "second");
      recordEvent("stream-5", "canceled", 1000, "third");

      const history = getStreamHistory("stream-5", 20, 0, "asc");

      expect(history.map((e) => e.actor)).toEqual(["first", "second", "third"]);
    });

    it("isolates events by streamId", async () => {
      const { recordEvent, getStreamHistory } = await import("./eventHistory");

      recordEvent("stream-A", "created", 1000);
      recordEvent("stream-B", "created", 500);
      recordEvent("stream-A", "claimed", 2000);

      const historyA = getStreamHistory("stream-A", 20, 0, "asc");
      const historyB = getStreamHistory("stream-B", 20, 0, "asc");

      expect(historyA).toHaveLength(2);
      expect(historyA.map((e) => e.timestamp)).toEqual([1000, 2000]);
      expect(historyB).toHaveLength(1);
      expect(historyB[0].timestamp).toBe(500);
    });
  });
});
