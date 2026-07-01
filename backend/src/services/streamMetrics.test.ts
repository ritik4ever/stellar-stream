import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { vi } from "vitest";

let db: InstanceType<typeof Database>;
vi.mock("./db", () => ({ getDb: () => db }));

const { getStreamMetrics, resetStreamMetricsCache } = await import("./streamMetrics");

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
const TODAY_START = Math.floor(
  Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  ) / 1000,
);

function insert(
  overrides: Partial<{
    id: string;
    asset_code: string;
    total_amount: number;
    duration_seconds: number;
    start_at: number;
    canceled_at: number | null;
    completed_at: number | null;
  }> = {},
  idx = 0,
) {
  const row = {
    id: overrides.id ?? `stream-${idx}`,
    sender: `GSENDER${idx}`,
    recipient: `GRECIP${idx}`,
    asset_code: overrides.asset_code ?? "USDC",
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

describe("getStreamMetrics", () => {
  beforeEach(() => {
    setupDb();
    resetStreamMetricsCache();
  });

  it("returns all zeros for an empty table", () => {
    const metrics = getStreamMetrics();
    expect(metrics.total_streams).toBe(0);
    expect(metrics.active_streams).toBe(0);
    expect(metrics.total_vested_usdc).toBe(0);
    expect(metrics.total_vested_xlm).toBe(0);
    expect(metrics.streams_completed_today).toBe(0);
  });

  it("counts total and active streams", () => {
    insert({ id: "s1" }, 1);
    insert({ id: "s2", start_at: NOW + 9999 }, 2);

    const metrics = getStreamMetrics();
    expect(metrics.total_streams).toBe(2);
    expect(metrics.active_streams).toBe(1);
  });

  it("computes vested amounts per asset", () => {
    insert({ id: "s1", asset_code: "USDC", total_amount: 1000, completed_at: NOW - 100 }, 1);
    insert({ id: "s2", asset_code: "XLM", total_amount: 500, completed_at: NOW - 100 }, 2);
    insert({ id: "s3", asset_code: "usdc", total_amount: 200, start_at: NOW - 1800 }, 3);

    const metrics = getStreamMetrics();
    expect(metrics.total_vested_usdc).toBe(1100);
    expect(metrics.total_vested_xlm).toBe(500);
  });

  it("counts streams completed today", () => {
    insert({ id: "s1", completed_at: TODAY_START + 60 }, 1);
    insert({ id: "s2", completed_at: TODAY_START + 120 }, 2);
    insert({ id: "s3", completed_at: TODAY_START - 86400 }, 3);

    const metrics = getStreamMetrics();
    expect(metrics.streams_completed_today).toBe(2);
  });

  it("returns cached result within TTL", () => {
    insert({ id: "s1" }, 1);
    const first = getStreamMetrics();
    insert({ id: "s2" }, 2);
    const second = getStreamMetrics();
    expect(second.total_streams).toBe(first.total_streams);
  });

  it("returns fresh result after cache reset", () => {
    insert({ id: "s1" }, 1);
    getStreamMetrics();
    insert({ id: "s2" }, 2);
    resetStreamMetricsCache();
    const fresh = getStreamMetrics();
    expect(fresh.total_streams).toBe(2);
  });
});
