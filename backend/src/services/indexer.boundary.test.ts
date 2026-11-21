import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  db: null as any,
  getEvents: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: () => h.db }));
vi.mock("@stellar/stellar-sdk", () => ({
  Networks: { TESTNET: "testnet" },
  Contract: class {},
  TransactionBuilder: class {},
  scValToNative: (x: any) => x,
  rpc: {
    Server: class {
      getLatestLedger = async () => ({ sequence: 100 });
      getEvents = h.getEvents;
    },
  },
}));

import {
  initIndexer, startIndexer, stopIndexer,
  resetIndexerState, getIndexerMonitoringSnapshot,
} from "./indexer";

const goodEvent = {
  topic: ["Stream", "Created"],
  value: { stream_id: 1, sender: "A", recipient: "B", token: "T",
           total_amount: 5, start_time: 1, end_time: 2 },
  ledger: 50,
  ledgerClosedAt: "2026-01-01T00:00:00Z",
};

const rows = () =>
  (h.db.prepare("SELECT COUNT(*) AS n FROM stream_events").get() as { n: number }).n;

async function runOnePoll() {
  startIndexer(1_000_000);
  await vi.waitFor(() =>
    expect(getIndexerMonitoringSnapshot().lastPollOutcome).not.toBeNull(),
  );
  stopIndexer();
  return getIndexerMonitoringSnapshot();
}

describe("indexer boundary behavior", () => {
  beforeEach(() => {
    resetIndexerState();
    h.getEvents.mockReset();
    h.db = new Database(":memory:");
    h.db.exec(`
      CREATE TABLE stream_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stream_id TEXT NOT NULL, event_type TEXT NOT NULL,
        ledger_sequence INTEGER, timestamp INTEGER NOT NULL,
        actor TEXT, amount REAL, metadata TEXT
      );
      CREATE UNIQUE INDEX idx_dedup
        ON stream_events(stream_id, event_type, ledger_sequence);
    `);
    initIndexer("http://rpc.test", "CONTRACT");
  });

  afterEach(() => stopIndexer());

  it("fails the poll and keeps the checkpoint when RPC replays the same cursor", async () => {
    h.getEvents.mockResolvedValue({ events: [goodEvent], cursor: "c1" });
    const snap = await runOnePoll();
    expect(snap.lastPollOutcome).toBe("rpc_error");
    expect(snap.indexedLedger).toBe(0);
  });

  it("does not advance the checkpoint when an event fails to process", async () => {
    const bad = { ...goodEvent, value: undefined };
    h.getEvents.mockResolvedValue({ events: [bad], cursor: undefined });
    const snap = await runOnePoll();
    expect(snap.lastPollOutcome).toBe("rpc_error");
    expect(snap.indexedLedger).toBe(0);
    expect(rows()).toBe(0);
  });

  it("dedupes a replayed page without duplicating rows", async () => {
    h.getEvents.mockResolvedValue({ events: [goodEvent], cursor: undefined });
    await runOnePoll();
    expect(rows()).toBe(1);

    // Simulate a crash: rows exist but the cursor was never saved
    h.db.prepare("DELETE FROM indexer_cursor").run();
    resetIndexerState();
    initIndexer("http://rpc.test", "CONTRACT");

    const snap = await runOnePoll();
    expect(h.getEvents).toHaveBeenCalledTimes(2);
    expect(snap.lastPollOutcome).toBe("restart_recovery");
    expect(rows()).toBe(1);
  });
});
