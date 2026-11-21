import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { recordEventWithDb } from "./eventHistory";

describe("recordEventWithDb replay", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE stream_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stream_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        ledger_sequence INTEGER,
        timestamp INTEGER NOT NULL,
        actor TEXT, amount REAL, metadata TEXT
      );
      CREATE UNIQUE INDEX idx_dedup
        ON stream_events(stream_id, event_type, ledger_sequence);
    `);
  });

  it("returns inserted for a new event", () => {
    const r = recordEventWithDb(db, "1", "created", 100, "A", 5, undefined, 10);
    expect(r).toBe("inserted");
  });

  it("returns deduped for the same event replayed", () => {
    recordEventWithDb(db, "1", "created", 100, "A", 5, undefined, 10);
    const r = recordEventWithDb(db, "1", "created", 100, "A", 5, undefined, 10);
    expect(r).toBe("deduped");
  });
});
