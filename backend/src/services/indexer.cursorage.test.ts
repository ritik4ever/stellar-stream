/**
 * Repeatable verification for Indexer monitoring (issue #1228).
 *
 * Drives the exact production poll path (`indexEvents`) through the three
 * situations the issue names and verifies the full observability contract —
 * lag, cursor age, and error counters — with a clear pass/fail result:
 *
 *   1. Healthy poll                        → lag returns to 0, cursor age
 *      fresh, zero new errors, outcome success.
 *   2. Lag increasing while RPC is healthy → `indexer_ledger_lag` grows across
 *      polls while `indexer_last_success_timestamp_seconds` freezes (cursor
 *      age grows) and `indexer_errors_total` climbs.
 *   3. RPC rate limit / disconnection      → failure kind is classified
 *      (`rate_limited`/`disconnected`), outcome moves to blocked once the
 *      circuit opens, and open-circuit polls stop hitting the RPC entirely.
 *
 * Run: cd backend && npx vitest run src/services/indexer.monitoring.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

// ── Metric doubles (recording, so tests can assert counter/gauge values) ───
const {
  metricCalls,
  eventsIndexedTotal,
  ledgersScannedTotal,
  lastIndexedLedger,
  indexerLatestLedger,
  indexerLedgerLag,
  indexerErrorsTotal,
  indexerCircuitState,
  indexerLastSuccessTimestampSeconds,
} = vi.hoisted(() => {
  const metricCalls: { name: string; op: "set" | "inc"; value?: number }[] = [];
  const makeCounter = (name: string) => ({
    inc: (v: number = 1) => metricCalls.push({ name, op: "inc", value: v }),
  });
  const makeGauge = (name: string) => ({
    set: (v: number) => metricCalls.push({ name, op: "set", value: v }),
  });
  return {
    metricCalls,
    eventsIndexedTotal: makeCounter("events_indexed_total"),
    ledgersScannedTotal: makeCounter("ledgers_scanned_total"),
    lastIndexedLedger: makeGauge("last_indexed_ledger"),
    indexerLatestLedger: makeGauge("indexer_latest_ledger"),
    indexerLedgerLag: makeGauge("indexer_ledger_lag"),
    indexerErrorsTotal: makeCounter("indexer_errors_total"),
    indexerCircuitState: makeGauge("indexer_circuit_state"),
    indexerLastSuccessTimestampSeconds: makeGauge(
      "indexer_last_success_timestamp_seconds"
    ),
  };
});

vi.mock("./metrics", () => ({
  eventsIndexedTotal,
  ledgersScannedTotal,
  lastIndexedLedger,
  indexerLatestLedger,
  indexerLedgerLag,
  indexerErrorsTotal,
  indexerCircuitState,
  indexerLastSuccessTimestampSeconds,
}));

// ── Real in-memory SQLite: exercises production transaction semantics ──────
let db: InstanceType<typeof Database>;
vi.mock("./db", () => ({ getDb: () => db }));

const { recordEventWithDb } = vi.hoisted(() => ({ recordEventWithDb: vi.fn() }));
vi.mock("./eventHistory", () => ({ recordEventWithDb }));

// ── Programmable RPC mock ──────────────────────────────────────────────────
const { mockGetLatestLedger, mockGetEvents } = vi.hoisted(() => ({
  mockGetLatestLedger: vi.fn(),
  mockGetEvents: vi.fn(),
}));

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    scValToNative: (v: any) => v,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(function () {
        return {
          getLatestLedger: mockGetLatestLedger,
          getEvents: mockGetEvents,
        };
      }),
    },
  };
});

// Import after all vi.mock() calls so the mocks are in place
import {
  initIndexer,
  indexEvents,
  resetIndexerState,
  getCircuitBreakerStatus,
  getIndexerMonitoringSnapshot,
} from "./indexer";
import { classifyIndexerOutcome } from "./indexerMonitor";

// ── Helpers ────────────────────────────────────────────────────────────────

let contractCounter = 0;
function nextContractId(): string {
  return `MONTEST${String(++contractCounter).padStart(4, "0")}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`.slice(0, 56);
}

function setupDb(): void {
  db = new Database(":memory:");
  db.exec(`
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
    CREATE TABLE indexer_cursor (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_ledger_sequence INTEGER NOT NULL
    );
  `);
}

/** Per-test unique contract IDs isolate the indexer's module-level state. */
beforeEach(() => {
  metricCalls.length = 0;
  vi.clearAllMocks();
  resetIndexerState();
  setupDb();
  mockGetLatestLedger.mockImplementation(async () => ({ sequence: 1000 }));
  mockGetEvents.mockImplementation(async () => ({ events: [] }));
});

afterEach(() => {
  vi.useRealTimers();
});

const lastSet = (name: string): number | undefined =>
  [...metricCalls].reverse().find((c) => c.name === name && c.op === "set")?.value;

const incCount = (name: string): number =>
  metricCalls
    .filter((c) => c.name === name && c.op === "inc")
    .reduce((sum, c) => sum + (c.value ?? 1), 0);

describe("indexer cursor-age verification (issue #1228)", () => {
  it("scenario 1 — healthy poll: lag 0, fresh cursor age, zero errors, outcome success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
    mockGetLatestLedger.mockImplementation(async () => ({ sequence: 1005 }));
    initIndexer("https://rpc.test", nextContractId(), "Test Passphrase");

    await indexEvents();

    expect(getIndexerMonitoringSnapshot().ledgerLag).toBe(0);
    expect(lastSet("last_indexed_ledger")).toBe(1005);
    expect(lastSet("indexer_last_success_timestamp_seconds")).toBe(
      Math.floor(Date.now() / 1000)
    );
    expect(incCount("indexer_errors_total")).toBe(0);
    expect(getCircuitBreakerStatus()).toBe("CLOSED");
    expect(classifyIndexerOutcome(getIndexerMonitoringSnapshot()).outcome).toBe(
      "success"
    );
  });

  it("scenario 2 — lag increasing while RPC is healthy: lag gauge grows, cursor age grows, errors climb", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
    initIndexer("https://rpc.test", nextContractId(), "Test Passphrase");

    // RPC answers getLatestLedger (healthy) but event fetches keep failing —
    // the exact "indexer falling behind a healthy RPC" signature.
    mockGetEvents.mockImplementation(async () => {
      throw new Error("event fetch timeout");
    });

    // Poll 1: head at 2000 → lag 2000.
    mockGetLatestLedger.mockImplementation(async () => ({ sequence: 2000 }));
    await indexEvents();
    const lag1 = getIndexerMonitoringSnapshot().ledgerLag;
    const ts1 = lastSet("indexer_last_success_timestamp_seconds");

    // 10s later, poll 2: head advanced to 2010 → lag 2010 (growing).
    vi.advanceTimersByTime(10_000);
    mockGetLatestLedger.mockImplementation(async () => ({ sequence: 2010 }));
    await indexEvents();
    const lag2 = getIndexerMonitoringSnapshot().ledgerLag;
    const ts2 = lastSet("indexer_last_success_timestamp_seconds");

    // RPC is healthy, yet the lag grows across polls...
    expect(lag1).toBe(2000);
    expect(lag2).toBe(2010);
    expect(lag2).toBeGreaterThan(lag1);
    // ...the cursor age grows (success timestamp frozen)...
    expect(ts2).toBe(ts1);
    expect(Date.now() / 1000 - (ts1 ?? 0)).toBeGreaterThanOrEqual(10);
    // ...and the error counter climbs even though getLatestLedger answers.
    expect(incCount("indexer_errors_total")).toBe(2);
    expect(getIndexerMonitoringSnapshot().consecutiveFailures).toBe(2);
  });

  it("scenario 3 — RPC rate limit / disconnection: failure kind classified, outcome blocked, open circuit stops polling", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
    initIndexer("https://rpc.test", nextContractId(), "Test Passphrase");

    // Healthy poll first: fresh timestamp, clean budget.
    await indexEvents();
    const freshTs = lastSet("indexer_last_success_timestamp_seconds");
    const errorsBefore = incCount("indexer_errors_total");
    const rpcCallsBefore = mockGetLatestLedger.mock.calls.length;

    // RPC goes away (rate limit / disconnect): every call rejects.
    mockGetLatestLedger.mockImplementation(async () => {
      throw Object.assign(new Error("429 too many requests"), { status: 429 });
    });

    // Five failing polls across time.
    for (let i = 1; i <= 5; i++) {
      vi.advanceTimersByTime(10_000);
      await indexEvents();
    }

    // Failure kind is classified without leaking the provider message.
    expect(getIndexerMonitoringSnapshot().lastFailureKind).toBe("rate_limited");
    // Outcome escalates to blocked (circuit OPEN after 5 consecutive failures).
    expect(getCircuitBreakerStatus()).toBe("OPEN");
    const signal = classifyIndexerOutcome(getIndexerMonitoringSnapshot());
    expect(signal.outcome).toBe("blocked");
    expect(signal.outcomeCode).toBe(2);
    // Cursor age grows: success timestamp frozen at the healthy poll.
    expect(lastSet("indexer_last_success_timestamp_seconds")).toBe(freshTs);
    expect(Date.now() / 1000 - (freshTs ?? 0)).toBeGreaterThanOrEqual(50);
    // Errors climbed by exactly the failing polls.
    expect(incCount("indexer_errors_total") - errorsBefore).toBe(5);
    // An OPEN circuit stops hitting the RPC entirely (protects the provider):
    // one more poll must add zero RPC calls to the five failed ones.
    const callsAfterFailures = mockGetLatestLedger.mock.calls.length;
    expect(callsAfterFailures).toBe(rpcCallsBefore + 5);
    await indexEvents();
    expect(mockGetLatestLedger.mock.calls.length).toBe(callsAfterFailures);
  });
});
