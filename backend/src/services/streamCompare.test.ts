import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

let db: InstanceType<typeof Database>;

vi.mock("./db", () => ({
  getDb: () => db,
  initDb: vi.fn(),
  syncFtsIndex: vi.fn(),
}));

vi.mock("./webhook", () => ({ triggerWebhook: vi.fn() }));

vi.mock("./cache", () => ({
  initCache: vi.fn(),
  getCache: () => ({
    get: async () => null,
    set: async () => {},
    del: async () => 0,
    clear: async () => {},
    isConnected: () => true,
  }),
}));

import { buildStreamComparison, compareStreams, type StreamRecord } from "./streamStore";

const NOW = Math.floor(Date.now() / 1000);

function setupDb() {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE streams (
      id TEXT PRIMARY KEY,
      sender TEXT NOT NULL,
      recipient TEXT NOT NULL,
      asset_code TEXT NOT NULL,
      total_amount REAL NOT NULL,
      duration_seconds INTEGER NOT NULL,
      start_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      canceled_at INTEGER,
      completed_at INTEGER,
      refunded_amount REAL,
      archived_at INTEGER,
      paused_at INTEGER,
      paused_duration INTEGER NOT NULL DEFAULT 0,
      cliff_seconds INTEGER NOT NULL DEFAULT 0,
      metadata TEXT
    );

    CREATE TABLE stream_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      ledger_sequence INTEGER,
      timestamp INTEGER NOT NULL,
      actor TEXT,
      amount REAL,
      metadata TEXT
    );
  `);
}

function insertStream(overrides: Partial<{
  id: string;
  total_amount: number;
  duration_seconds: number;
  start_at: number;
  canceled_at: number | null;
  completed_at: number | null;
  paused_at: number | null;
  paused_duration: number;
}> = {}) {
  db.prepare(
    `INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds,
       start_at, created_at, canceled_at, completed_at, refunded_amount, archived_at,
       paused_at, paused_duration, cliff_seconds, metadata)
     VALUES (@id, 'GSENDER', 'GRECIPIENT', 'USDC', @total_amount, @duration_seconds,
       @start_at, @start_at, @canceled_at, @completed_at, NULL, NULL,
       @paused_at, @paused_duration, 0, NULL)`,
  ).run({
    id: overrides.id ?? "1",
    total_amount: overrides.total_amount ?? 1000,
    duration_seconds: overrides.duration_seconds ?? 1000,
    start_at: overrides.start_at ?? NOW - 500,
    canceled_at: overrides.canceled_at ?? null,
    completed_at: overrides.completed_at ?? null,
    paused_at: overrides.paused_at ?? null,
    paused_duration: overrides.paused_duration ?? 0,
  });
}

function insertClaim(streamId: string, amount: number, at = NOW - 10) {
  db.prepare(
    `INSERT INTO stream_events (stream_id, event_type, timestamp, actor, amount)
     VALUES (?, 'claimed', ?, 'GCLAIMER', ?)`,
  ).run(streamId, at, amount);
}

const record = (overrides: Partial<StreamRecord> = {}): StreamRecord => ({
  id: "1",
  sender: "GSENDER",
  recipient: "GRECIPIENT",
  assetCode: "USDC",
  totalAmount: 1000,
  durationSeconds: 1000,
  startAt: NOW - 500,
  createdAt: NOW - 500,
  pausedDuration: 0,
  cliffSeconds: 0,
  ...overrides,
});

describe("buildStreamComparison", () => {
  beforeEach(() => {
    setupDb();
  });

  it("derives vested, claimed and claimable at a fixed timestamp", () => {
    insertClaim("1", 200);

    const entry = buildStreamComparison(record(), NOW);

    expect(entry.vested).toBe(500);
    expect(entry.claimed).toBe(200);
    expect(entry.claimable).toBe(300);
    expect(entry.status).toBe("active");
    expect(entry.elapsed_pct).toBe(50);
    expect(entry.totalAmount).toBe(1000);
  });

  it("sums every claim event for the stream", () => {
    insertClaim("1", 100);
    insertClaim("1", 50.5);

    const entry = buildStreamComparison(record(), NOW);

    expect(entry.claimed).toBe(150.5);
    expect(entry.claimable).toBe(349.5);
  });

  it("clamps claimable to zero when claims exceed the vested amount", () => {
    insertClaim("1", 600);

    const entry = buildStreamComparison(record(), NOW);

    expect(entry.vested).toBe(500);
    expect(entry.claimed).toBe(600);
    expect(entry.claimable).toBe(0);
  });

  it("reports zero days remaining for terminal streams", () => {
    const completed = buildStreamComparison(
      record({ completedAt: NOW - 10 }),
      NOW,
    );
    const canceled = buildStreamComparison(
      record({ canceledAt: NOW - 10 }),
      NOW,
    );

    expect(completed.status).toBe("completed");
    expect(completed.days_remaining).toBe(0);
    expect(canceled.status).toBe("canceled");
    expect(canceled.days_remaining).toBe(0);
  });

  it("computes days_remaining from the (pause-adjusted) end time", () => {
    const entry = buildStreamComparison(record(), NOW);
    // end = start + duration = NOW + 500 seconds.
    expect(entry.endAt).toBe(NOW + 500);
    expect(entry.days_remaining).toBeCloseTo(500 / 86400, 6);
  });
});

describe("compareStreams", () => {
  beforeEach(() => {
    setupDb();
  });

  it("compares 2-5 streams using one shared timestamp", () => {
    insertStream({ id: "1", total_amount: 1000, duration_seconds: 1000, start_at: NOW - 500 });
    insertStream({ id: "2", total_amount: 500, duration_seconds: 1000, start_at: NOW - 500 });

    const entries = compareStreams(["1", "2"], NOW);

    expect(entries).toHaveLength(2);
    // Same start/duration => identical elapsed percentage at the same `at`.
    expect(entries[0].elapsed_pct).toBe(entries[1].elapsed_pct);
    expect(entries[0].vested).toBe(500);
    expect(entries[1].vested).toBe(250);
    expect(entries.map((e) => e.id)).toEqual(["1", "2"]);
  });

  it("preserves the requested order", () => {
    insertStream({ id: "1" });
    insertStream({ id: "2" });

    const entries = compareStreams(["2", "1"], NOW);

    expect(entries.map((e) => e.id)).toEqual(["2", "1"]);
  });

  it("throws a 404-tagged error naming the unknown stream", () => {
    insertStream({ id: "1" });

    expect.assertions(3);
    try {
      compareStreams(["1", "999"], NOW);
    } catch (error: any) {
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe("NOT_FOUND");
      expect(error.message).toContain("999");
    }
  });
});
