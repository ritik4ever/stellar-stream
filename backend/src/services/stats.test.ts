import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { vi } from "vitest";

let db: InstanceType<typeof Database>;
vi.mock("./db", () => ({ getDb: () => db }));

const { getStreamStats, getGlobalStats, resetStatsCache } = require("./stats");

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
      paused_duration INTEGER NOT NULL DEFAULT 0
    );
  `);
}

const NOW = Math.floor(Date.now() / 1000);

function insert(overrides: Partial<{
  id: string; sender: string; recipient: string;
  total_amount: number; duration_seconds: number;
  start_at: number; canceled_at: number | null; completed_at: number | null;
}> = {}, idx = 0) {
  const row = {
    id: overrides.id ?? `stream-${idx}`,
    sender: overrides.sender ?? `GSENDER${idx}`,
    recipient: overrides.recipient ?? `GRECIP${idx}`,
    asset_code: "USDC",
    total_amount: overrides.total_amount ?? 1000,
    duration_seconds: overrides.duration_seconds ?? 3600,
    start_at: overrides.start_at ?? NOW - 1800,
    created_at: NOW - 3600,
    canceled_at: overrides.canceled_at ?? null,
    completed_at: overrides.completed_at ?? null,
    refunded_amount: null,
    archived_at: null,
    paused_at: null,
    paused_duration: 0,
  };
  db.prepare(`
    INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds,
      start_at, created_at, canceled_at, completed_at, refunded_amount, archived_at,
      paused_at, paused_duration)
    VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds,
      @start_at, @created_at, @canceled_at, @completed_at, @refunded_amount, @archived_at,
      @paused_at, @paused_duration)
  `).run(row);
}

describe("getStreamStats", () => {
  beforeEach(() => {
    setupDb();
    resetStatsCache();
  });

  it("returns all zeros for an empty table", () => {
    const stats = getStreamStats();
    expect(stats.total_streams).toBe(0);
    expect(stats.active_streams).toBe(0);
    expect(stats.completed_streams).toBe(0);
    expect(stats.canceled_streams).toBe(0);
    expect(stats.total_vested).toBe(0);
    expect(stats.avg_duration_seconds).toBe(0);
    expect(stats.unique_senders).toBe(0);
    expect(stats.unique_recipients).toBe(0);
  });

  it("counts total, active, completed, canceled streams correctly", () => {
    insert({ id: "s1", canceled_at: null, completed_at: null }, 1);   // active
    insert({ id: "s2", canceled_at: NOW - 100, completed_at: null }, 2); // canceled
    insert({ id: "s3", canceled_at: null, completed_at: NOW - 100 }, 3); // completed
    insert({ id: "s4", start_at: NOW + 9999 }, 4); // scheduled (not active yet)

    const stats = getStreamStats();
    expect(stats.total_streams).toBe(4);
    expect(stats.active_streams).toBe(1);
    expect(stats.canceled_streams).toBe(1);
    expect(stats.completed_streams).toBe(1);
  });

  it("counts unique senders and recipients", () => {
    insert({ id: "s1", sender: "GSENDER_A", recipient: "GRECIP_A" }, 1);
    insert({ id: "s2", sender: "GSENDER_A", recipient: "GRECIP_B" }, 2);
    insert({ id: "s3", sender: "GSENDER_B", recipient: "GRECIP_A" }, 3);

    const stats = getStreamStats();
    expect(stats.unique_senders).toBe(2);
    expect(stats.unique_recipients).toBe(2);
  });

  it("computes avg_duration_seconds correctly", () => {
    insert({ id: "s1", duration_seconds: 1000 }, 1);
    insert({ id: "s2", duration_seconds: 3000 }, 2);

    const stats = getStreamStats();
    expect(stats.avg_duration_seconds).toBe(2000);
  });

  it("returns cached result within TTL", () => {
    insert({ id: "s1" }, 1);
    const first = getStreamStats();
    // Insert another row — should NOT appear in cached result
    insert({ id: "s2" }, 2);
    const second = getStreamStats();
    expect(second.total_streams).toBe(first.total_streams);
  });

  it("returns fresh result after cache is reset", () => {
    insert({ id: "s1" }, 1);
    getStreamStats(); // prime cache
    insert({ id: "s2" }, 2);
    resetStatsCache();
    const fresh = getStreamStats();
    expect(fresh.total_streams).toBe(2);
  });
});

describe("getGlobalStats – localStreamCount and onChainStreamCount", () => {
  beforeEach(() => {
    setupDb();
    resetStatsCache();
  });

  it("returns localStreamCount=0 and onChainStreamCount=null with no streams", () => {
    const stats = getGlobalStats();
    expect(stats.localStreamCount).toBe(0);
    expect(stats.onChainStreamCount).toBeNull();
  });

  it("returns localStreamCount=1 after a single stream is inserted", () => {
    insert({ id: "s1" }, 1);
    resetStatsCache();
    const stats = getGlobalStats();
    expect(stats.localStreamCount).toBe(1);
  });

  it("returns localStreamCount=N after N streams are inserted", () => {
    for (let i = 0; i < 5; i++) {
      insert({ id: `s${i}` }, i);
    }
    resetStatsCache();
    const stats = getGlobalStats();
    expect(stats.localStreamCount).toBe(5);
  });

  it("localStreamCount always equals total", () => {
    insert({ id: "s1" }, 1);
    insert({ id: "s2", canceled_at: NOW - 10 }, 2);
    resetStatsCache();
    const stats = getGlobalStats();
    expect(stats.localStreamCount).toBe(stats.total);
  });
});

