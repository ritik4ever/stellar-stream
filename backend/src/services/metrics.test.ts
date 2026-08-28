import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";

let db: InstanceType<typeof Database>;
vi.mock("./db", () => ({ getDb: () => db }));

import {
  register,
  refreshPrometheusStreamMetrics,
  resetPrometheusStreamMetricsCache,
  resetIndexerLag,
  recordIndexerSuccess,
} from "./metrics";

const NOW = Math.floor(Date.now() / 1000);

function setupDb(): void {
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

function insertStream(overrides: Record<string, any> = {}): void {
  const row = {
    id: `s-${Math.random().toString(36).slice(2, 10)}`,
    sender: "GSENDER",
    recipient: "GRECIPIENT",
    asset_code: "USDC",
    total_amount: 100,
    duration_seconds: 3600,
    start_at: NOW - 100,
    created_at: NOW - 1000,
    canceled_at: null,
    completed_at: null,
    refunded_amount: null,
    archived_at: null,
    paused_at: null,
    paused_duration: 0,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at, canceled_at, completed_at, refunded_amount, archived_at, paused_at, paused_duration)
     VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at, @canceled_at, @completed_at, @refunded_amount, @archived_at, @paused_at, @paused_duration)`,
  ).run(row);
}

function insertEvent(streamId: string, eventType: string, timestamp = NOW): void {
  db.prepare(
    `INSERT INTO stream_events (stream_id, event_type, ledger_sequence, timestamp, actor, amount, metadata)
     VALUES (@streamId, @eventType, NULL, @timestamp, NULL, NULL, NULL)`,
  ).run({ streamId, eventType, timestamp });
}

async function getGaugeValues(name: string): Promise<Record<string, number>> {
  // Parse the rendered Prometheus text output so labelled and unlabelled
  // gauges (including the collect()-based indexer_lag_seconds) are read the
  // same way a real scrape would see them.
  const output = await register.metrics();
  const values: Record<string, number> = {};
  let inSection = false;
  for (const line of output.split("\n")) {
    if (line.startsWith(`# HELP ${name} `) || line.startsWith(`# TYPE ${name} `)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (line.startsWith("#") || line.trim() === "") break;
      const sample = line.match(/^(.*?)\s+([0-9.eE+-]+)$/);
      if (sample) {
        const labels = sample[1];
        const value = parseFloat(sample[2]);
        const labelMatch = labels.match(/status="([^"]*)"/);
        values[labelMatch ? labelMatch[1] : "value"] = value;
      }
    }
  }
  return values;
}

function totalCount(values: Record<string, number>): number {
  return Object.values(values).reduce((a, b) => a + b, 0);
}

beforeEach(() => {
  setupDb();
  resetPrometheusStreamMetricsCache();
  resetIndexerLag();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("refreshPrometheusStreamMetrics", () => {
  it("classifies streams by status, mirroring computeStatus", async () => {
    insertStream({ id: "active-1" });
    insertStream({ id: "scheduled-1", start_at: NOW + 3600 });
    insertStream({ id: "paused-1", paused_at: NOW - 10 });
    insertStream({ id: "completed-1", completed_at: NOW - 10 });
    // No completed_at, but fully elapsed by time.
    insertStream({ id: "elapsed-1", start_at: NOW - 7200, duration_seconds: 3600 });
    insertStream({ id: "canceled-1", canceled_at: NOW - 10 });
    // Archived streams are historical and must be excluded.
    insertStream({ id: "archived-1", completed_at: NOW - 10, archived_at: NOW - 5 });

    refreshPrometheusStreamMetrics();

    const values = await getGaugeValues("stream_count");
    expect(values["active"]).toBe(1);
    expect(values["scheduled"]).toBe(1);
    expect(values["paused"]).toBe(1);
    expect(values["completed"]).toBe(2); // completed-1 + elapsed-1
    expect(values["canceled"]).toBe(1);
    expect(totalCount(values)).toBe(6);
  });

  it("resets labels that no longer have streams to zero", async () => {
    insertStream({ id: "a", canceled_at: NOW - 10 });
    refreshPrometheusStreamMetrics();
    expect((await getGaugeValues("stream_count"))["canceled"]).toBe(1);

    setupDb(); // fresh DB with no streams
    resetPrometheusStreamMetricsCache();
    refreshPrometheusStreamMetrics();

    const values = await getGaugeValues("stream_count");
    expect(values["canceled"]).toBe(0);
    expect(totalCount(values)).toBe(0);
  });

  it("counts claims and cancels from stream_events", async () => {
    insertEvent("s1", "created");
    insertEvent("s1", "claimed");
    insertEvent("s1", "claimed");
    insertEvent("s1", "canceled");
    insertEvent("s2", "claimed");

    refreshPrometheusStreamMetrics();

    expect((await getGaugeValues("claim_count")).value).toBe(3);
    expect((await getGaugeValues("cancel_count")).value).toBe(1);
  });

  it("caches results within the TTL window", async () => {
    insertStream({ id: "a" });
    refreshPrometheusStreamMetrics();
    insertStream({ id: "b" });
    refreshPrometheusStreamMetrics(); // served from cache — b is not visible
    expect((await getGaugeValues("stream_count"))["active"]).toBe(1);

    resetPrometheusStreamMetricsCache();
    refreshPrometheusStreamMetrics();
    expect((await getGaugeValues("stream_count"))["active"]).toBe(2);
  });
});

describe("indexerLagSeconds", () => {
  it("reports 0 before the indexer has ever succeeded", async () => {
    resetIndexerLag();
    expect((await getGaugeValues("indexer_lag_seconds")).value).toBe(0);
  });

  it("grows past 60s when the indexer stops reporting success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T00:00:00Z"));
    recordIndexerSuccess();

    vi.setSystemTime(new Date("2026-07-26T00:01:30Z")); // 90 seconds later
    expect((await getGaugeValues("indexer_lag_seconds")).value).toBeGreaterThan(60);
  });

  it("returns to ~0 right after a successful poll", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T00:00:00Z"));
    recordIndexerSuccess();

    vi.setSystemTime(new Date("2026-07-26T00:01:30Z"));
    expect((await getGaugeValues("indexer_lag_seconds")).value).toBeGreaterThan(60);

    recordIndexerSuccess();
    expect((await getGaugeValues("indexer_lag_seconds")).value).toBeLessThan(1);
  });
});
