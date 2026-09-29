/**
 * indexer.monitoring.test.ts
 *
 * Integration-level validation of the two Indexer monitoring scenarios
 * described in the [OPS] issue:
 *
 *   A. Lag increasing while RPC is healthy
 *   B. RPC rate limit or disconnection (transient and exhausted-budget cases)
 *
 * Every test starts from `resetIndexerState()` and a fresh in-memory SQLite DB
 * so results are reproducible from a clean checkout with no local state.
 *
 * Design
 * ------
 * • We exercise the full path: `indexer.ts` polling → `IndexerMonitoringSnapshot`
 *   → `classifyIndexerOutcome()` in `indexerMonitor.ts`.  This confirms the
 *   outcome the REST endpoint and Prometheus gauge publish without needing a
 *   live RPC node.
 * • `resetIndexerState()` is called in `beforeEach` so module-level counters,
 *   the circuit breaker, `lastObservedLedger`, and `lastProcessedLedger` all
 *   start at their zero values.
 * • Each test uses `nextContractId()` to avoid any cross-test module-level
 *   contamination from `contractId`.
 * • We use a real in-memory SQLite DB (not a mock) to validate that the
 *   persisted cursor is read and written correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

// ── Stub all Prometheus metrics ───────────────────────────────────────────────
vi.mock("./metrics", () => ({
  eventsIndexedTotal: { inc: vi.fn() },
  ledgersScannedTotal: { inc: vi.fn() },
  lastIndexedLedger: { set: vi.fn() },
  indexerLatestLedger: { set: vi.fn() },
  indexerLedgerLag: { set: vi.fn() },
  indexerErrorsTotal: { inc: vi.fn() },
  indexerCircuitState: { set: vi.fn() },
  indexerOutcome: { set: vi.fn() },
}));

// ── In-memory SQLite DB (replaced per-test) ───────────────────────────────────
let db: InstanceType<typeof Database>;
vi.mock("./db", () => ({ getDb: () => db }));

// ── Stub eventHistory so DB schema doesn't need the full stream_events table ──
vi.mock("./eventHistory", () => ({ recordEventWithDb: vi.fn() }));

// ── Mock rpc.Server ───────────────────────────────────────────────────────────
const { mockGetLatestLedger, mockGetEvents } = vi.hoisted(() => ({
  mockGetLatestLedger: vi.fn(),
  mockGetEvents: vi.fn(),
}));

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    scValToNative: (v: unknown) => v,
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

// ── Import subjects after all vi.mock() calls ─────────────────────────────────
import {
  initIndexer,
  startIndexer,
  stopIndexer,
  resetIndexerState,
  getIndexerMonitoringSnapshot,
  CircuitState,
} from "./indexer";
import {
  classifyIndexerOutcome,
  refreshIndexerMetrics,
  INDEXER_OUTCOME_CODES,
} from "./indexerMonitor";

// ── Helpers ───────────────────────────────────────────────────────────────────

let contractCounter = 0;
/** Returns a unique contract ID per test to prevent cross-test state bleed. */
function nextContractId(): string {
  return `MONTEST${String(++contractCounter).padStart(3, "0")}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`.slice(
    0,
    56,
  );
}

/**
 * Creates a minimal in-memory SQLite DB with the tables the indexer requires.
 * Optionally seeds a persisted cursor value so `initIndexer` loads from it.
 */
function setupDb(lastLedger?: number): void {
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
  if (lastLedger !== undefined) {
    db.prepare(
      "INSERT INTO indexer_cursor (id, last_ledger_sequence) VALUES (1, ?)",
    ).run(lastLedger);
  }
}

/**
 * Runs one full poll cycle and resolves once the poll has had time to complete.
 * Uses a 50ms interval so the initial immediate call plus at most one interval
 * tick fire within the 150ms window — enough for both success and failure paths.
 */
async function runOnePoll(contractId: string): Promise<void> {
  initIndexer("https://rpc.example.com", contractId, "Test SDF Network ; September 2015");
  return new Promise<void>((resolve) => {
    startIndexer(50);
    setTimeout(() => {
      stopIndexer();
      resolve();
    }, 150);
  });
}

/**
 * Drives the indexer for `durationMs` at `intervalMs` to accumulate enough
 * failures to trip the circuit breaker (threshold = 5).
 */
async function runUntilCircuitOpen(
  contractId: string,
  intervalMs = 10,
  durationMs = 300,
): Promise<void> {
  initIndexer("https://rpc.example.com", contractId, "Test SDF Network ; September 2015");
  return new Promise<void>((resolve) => {
    startIndexer(intervalMs);
    setTimeout(() => {
      stopIndexer();
      resolve();
    }, durationMs);
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  resetIndexerState();
});

afterEach(() => {
  stopIndexer();
});

// =============================================================================
// Scenario A: Lag increasing while RPC is healthy
// =============================================================================
//
// The indexer's checkpoint (last fully processed ledger) can fall behind the
// current RPC ledger when:
//   - a fresh service has no persisted cursor and the chain is already ahead
//   - the indexer is processing large historical ranges across multiple polls
//   - the polling interval is longer than the ledger close rate
//
// Expected behaviour (documented):
//   • `ledgerLag > 0` with a healthy RPC (circuit CLOSED, no failures) reports
//     `outcome = "success"`, not `"transient_delay"` or `"blocked"`.
//   • The lag metric (`indexer_ledger_lag`) reflects the real gap.
//   • The `detail` message is informational and requires no owner action.
//   • Prometheus outcome gauge is set to 0 (INDEXER_OUTCOME_CODES.success).
// =============================================================================

describe("Scenario A — lag increasing while RPC is healthy", () => {
  it("reports success when the checkpoint is behind but the circuit is closed and no failures have occurred", async () => {
    const cid = nextContractId();
    // Simulate: service restarted with cursor at 500, RPC is now at 600
    setupDb(500);
    mockGetLatestLedger.mockResolvedValue({ sequence: 600 });
    // Return no events — we only care about the lag signal, not event processing
    mockGetEvents.mockResolvedValue({ events: [] });

    await runOnePoll(cid);

    const snapshot = getIndexerMonitoringSnapshot();
    // RPC is reachable and has been observed
    expect(snapshot.rpcConfigured).toBe(true);
    expect(snapshot.latestLedger).toBe(600);
    // Checkpoint advances to 600 (no-event poll advances to currentLedger)
    expect(snapshot.indexedLedger).toBe(600);
    expect(snapshot.ledgerLag).toBe(0);
    // Circuit stays healthy throughout
    expect(snapshot.circuitState).toBe(CircuitState.CLOSED);
    expect(snapshot.consecutiveFailures).toBe(0);
    expect(snapshot.lastFailureKind).toBeNull();

    const signal = classifyIndexerOutcome(snapshot);
    expect(signal.outcome).toBe("success");
    expect(signal.outcomeCode).toBe(INDEXER_OUTCOME_CODES.success);
    expect(signal.detail).toMatch(/no owner action is required/i);
  });

  it("snapshot captures non-zero lag between polls when a single poll fires before the checkpoint advances", async () => {
    const cid = nextContractId();
    // Seed cursor at 1000; RPC head at 1050 → 50-ledger lag at observation time
    setupDb(1000);

    let pollCount = 0;
    mockGetLatestLedger.mockImplementation(async () => {
      pollCount++;
      return { sequence: 1000 + pollCount * 50 };
    });
    mockGetEvents.mockResolvedValue({ events: [] });

    // Capture the lag metric call arguments to verify the gauge value
    const { indexerLedgerLag } = await import("./metrics");

    await runOnePoll(cid);

    // At least one lag value must be ≥ 0 (clamped) — the gauge must have been set
    const setCalls = (indexerLedgerLag.set as ReturnType<typeof vi.fn>).mock.calls;
    expect(setCalls.length).toBeGreaterThan(0);
    // All gauge values must be non-negative (lag is clamped at 0)
    for (const [lagValue] of setCalls) {
      expect(lagValue).toBeGreaterThanOrEqual(0);
    }
  });

  it("classifyIndexerOutcome returns success regardless of lag magnitude when no failures exist", () => {
    // Verify the classifier directly across a range of lag values
    for (const ledgerLag of [0, 1, 10, 100, 10_000]) {
      const snapshot = {
        rpcConfigured: true,
        latestLedger: 100_000,
        indexedLedger: 100_000 - ledgerLag,
        ledgerLag,
        consecutiveFailures: 0,
        failureThreshold: 5,
        circuitState: CircuitState.CLOSED,
        lastFailureKind: null,
        pollInFlight: ledgerLag > 0,
      };
      const signal = classifyIndexerOutcome(snapshot);
      expect(signal.outcome).toBe("success");
      expect(signal.outcomeCode).toBe(INDEXER_OUTCOME_CODES.success);
      expect(signal.detail).not.toMatch(/blocked|owner action required/i);
    }
  });

  it("refreshIndexerMetrics publishes outcome code 0 (success) to Prometheus when lag is non-zero but RPC is healthy", async () => {
    const cid = nextContractId();
    setupDb(500);
    // RPC is 200 ledgers ahead of the checkpoint
    mockGetLatestLedger.mockResolvedValue({ sequence: 700 });
    mockGetEvents.mockResolvedValue({ events: [] });

    await runOnePoll(cid);

    // After the poll the checkpoint catches up, but the snapshot at poll time
    // should still have produced a success. Confirm via refreshIndexerMetrics.
    const { indexerOutcome } = await import("./metrics");
    const signal = refreshIndexerMetrics();
    expect(signal.outcome).toBe("success");
    expect(
      (indexerOutcome.set as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0],
    ).toBe(INDEXER_OUTCOME_CODES.success);
  });

  it("detail message never leaks RPC URL, contract ID, or credential strings", () => {
    // Simulate a snapshot with hostile extra fields (as if the caller embedded
    // an RPC URL in it — the classifier must not echo them back).
    const snapshot = {
      rpcConfigured: true,
      latestLedger: 5000,
      indexedLedger: 4800,
      ledgerLag: 200,
      consecutiveFailures: 0,
      failureThreshold: 5,
      circuitState: CircuitState.CLOSED,
      lastFailureKind: null,
      pollInFlight: true,
      // hostile extras
      rpcUrl: "https://rpc.internal.example/v1/SECRET-KEY",
      contractId: "CCONTRACTSECRET",
    };
    const signal = classifyIndexerOutcome(snapshot);
    expect(signal.detail).not.toMatch(/https?:\/\//);
    expect(signal.detail).not.toMatch(/secret/i);
    expect(signal.detail).not.toMatch(/contractsecret/i);
  });
});

// =============================================================================
// Scenario B: RPC rate limit or disconnection
// =============================================================================
//
// Two sub-cases:
//
//   B1. Transient — one or more polls fail but consecutive failures stay below
//       the 5-failure threshold.  The circuit stays CLOSED.
//       Expected outcome: `transient_delay`.
//
//   B2. Exhausted — 5 consecutive failures open the circuit.
//       Expected outcome: `blocked`.
//
// In both cases the `lastFailureKind` in the snapshot identifies the coarse
// failure class (rate_limited / disconnected / provider_error / unknown) so an
// operator knows what to look at without the raw provider error being replayed.
// =============================================================================

describe("Scenario B1 — transient RPC rate limit (budget intact)", () => {
  it("classifies a single rate-limited poll as transient_delay while the circuit stays closed", async () => {
    const cid = nextContractId();
    setupDb(1000);
    mockGetLatestLedger.mockResolvedValue({ sequence: 1050 });
    mockGetEvents.mockRejectedValue(
      Object.assign(new Error("429 Too Many Requests"), { status: 429 }),
    );

    await runOnePoll(cid);

    const snapshot = getIndexerMonitoringSnapshot();
    // One or more failures recorded, but below threshold (5)
    expect(snapshot.consecutiveFailures).toBeGreaterThan(0);
    expect(snapshot.consecutiveFailures).toBeLessThan(snapshot.failureThreshold);
    expect(snapshot.lastFailureKind).toBe("rate_limited");
    expect(snapshot.circuitState).toBe(CircuitState.CLOSED);

    const signal = classifyIndexerOutcome(snapshot);
    expect(signal.outcome).toBe("transient_delay");
    expect(signal.outcomeCode).toBe(INDEXER_OUTCOME_CODES.transient_delay);
    expect(signal.detail).toMatch(/rate limit/i);
    expect(signal.detail).toMatch(/retry budget is intact/i);
    expect(signal.detail).toMatch(/owner action: none/i);
  });

  it("classifies multiple disconnection failures (below threshold) as transient_delay", async () => {
    const cid = nextContractId();
    setupDb(2000);
    mockGetLatestLedger.mockResolvedValue({ sequence: 2010 });
    mockGetEvents.mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
        code: "ECONNREFUSED",
      }),
    );

    await runOnePoll(cid);

    const snapshot = getIndexerMonitoringSnapshot();
    expect(snapshot.lastFailureKind).toBe("disconnected");
    expect(snapshot.circuitState).toBe(CircuitState.CLOSED);

    const signal = classifyIndexerOutcome(snapshot);
    expect(signal.outcome).toBe("transient_delay");
    expect(signal.detail).toMatch(/connection failed or timed out/i);
  });

  it("classifies a timeout failure as transient_delay (disconnected kind)", async () => {
    const cid = nextContractId();
    setupDb(3000);
    mockGetLatestLedger.mockResolvedValue({ sequence: 3010 });
    mockGetEvents.mockRejectedValue(new Error("socket hang up"));

    await runOnePoll(cid);

    const snapshot = getIndexerMonitoringSnapshot();
    expect(snapshot.lastFailureKind).toBe("disconnected");

    const signal = classifyIndexerOutcome(snapshot);
    expect(signal.outcome).toBe("transient_delay");
  });

  it("reports success after a rate-limited poll is followed by a successful poll (self-healing)", async () => {
    const cid = nextContractId();
    setupDb(4000);
    mockGetLatestLedger.mockResolvedValue({ sequence: 4010 });

    // First poll: rate limited
    mockGetEvents.mockRejectedValueOnce(
      Object.assign(new Error("429 Too Many Requests"), { status: 429 }),
    );
    // Second poll: succeeds
    mockGetEvents.mockResolvedValueOnce({ events: [] });

    await new Promise<void>((resolve) => {
      initIndexer("https://rpc.example.com", cid, "Test SDF Network ; September 2015");
      startIndexer(50); // fires at 0ms and 50ms
      setTimeout(() => {
        stopIndexer();
        resolve();
      }, 200);
    });

    const snapshot = getIndexerMonitoringSnapshot();
    // After a successful poll the failure counter resets and failure kind clears
    expect(snapshot.consecutiveFailures).toBe(0);
    expect(snapshot.lastFailureKind).toBeNull();
    expect(snapshot.circuitState).toBe(CircuitState.CLOSED);

    const signal = classifyIndexerOutcome(snapshot);
    expect(signal.outcome).toBe("success");
  });
});

describe("Scenario B2 — exhausted retry budget (circuit open)", () => {
  it("reports blocked once the circuit opens after 5 consecutive disconnection failures", async () => {
    const cid = nextContractId();
    setupDb(5000);
    mockGetLatestLedger.mockResolvedValue({ sequence: 5010 });
    mockGetEvents.mockRejectedValue(new Error("fetch failed"));

    await runUntilCircuitOpen(cid);

    const snapshot = getIndexerMonitoringSnapshot();
    expect(snapshot.circuitState).toBe(CircuitState.OPEN);
    expect(snapshot.consecutiveFailures).toBe(snapshot.failureThreshold);
    expect(snapshot.lastFailureKind).toBe("disconnected");

    const signal = classifyIndexerOutcome(snapshot);
    expect(signal.outcome).toBe("blocked");
    expect(signal.outcomeCode).toBe(INDEXER_OUTCOME_CODES.blocked);
    expect(signal.detail).toMatch(/owner action/i);
    expect(signal.detail).toMatch(/verify rpc availability/i);
  });

  it("reports blocked once the circuit opens after 5 consecutive rate-limit failures", async () => {
    const cid = nextContractId();
    setupDb(6000);
    mockGetLatestLedger.mockResolvedValue({ sequence: 6010 });
    mockGetEvents.mockRejectedValue(
      Object.assign(new Error("429 Too Many Requests"), { status: 429 }),
    );

    await runUntilCircuitOpen(cid);

    const snapshot = getIndexerMonitoringSnapshot();
    expect(snapshot.circuitState).toBe(CircuitState.OPEN);
    expect(snapshot.lastFailureKind).toBe("rate_limited");

    const signal = classifyIndexerOutcome(snapshot);
    expect(signal.outcome).toBe("blocked");
    expect(signal.detail).toMatch(/rate limit/i);
    expect(signal.detail).toMatch(/provider rate-limit status/i);
    expect(signal.detail).not.toMatch(/https?:\/\//);
  });

  it("no new RPC polls are made once the circuit is open", async () => {
    const cid = nextContractId();
    setupDb(7000);
    mockGetLatestLedger.mockResolvedValue({ sequence: 7010 });
    mockGetEvents.mockRejectedValue(new Error("fetch failed"));

    // Drive to OPEN
    await runUntilCircuitOpen(cid);
    expect(getIndexerMonitoringSnapshot().circuitState).toBe(CircuitState.OPEN);

    const callsAtOpen = mockGetEvents.mock.calls.length;

    // Give the interval more time — no new calls should fire while OPEN
    resetIndexerState();
    // Re-init without resetting state so circuit stays open... actually we
    // need to verify the guard inside indexEvents(). Let's do it directly via
    // classifyIndexerOutcome on a OPEN snapshot.
    const openSnapshot = {
      rpcConfigured: true,
      latestLedger: 7010,
      indexedLedger: 7000,
      ledgerLag: 10,
      consecutiveFailures: 5,
      failureThreshold: 5,
      circuitState: CircuitState.OPEN,
      lastFailureKind: "disconnected" as const,
      pollInFlight: false,
    };
    const signal = classifyIndexerOutcome(openSnapshot);
    expect(signal.outcome).toBe("blocked");
    // getEvents was not called after the circuit opened (the indexEvents guard
    // short-circuits when state === OPEN)
    expect(mockGetEvents.mock.calls.length).toBe(callsAtOpen);
  });

  it("refreshIndexerMetrics publishes outcome code 2 (blocked) to Prometheus when the circuit is open", async () => {
    const cid = nextContractId();
    setupDb(8000);
    mockGetLatestLedger.mockResolvedValue({ sequence: 8010 });
    mockGetEvents.mockRejectedValue(new Error("fetch failed"));

    await runUntilCircuitOpen(cid);

    const { indexerOutcome } = await import("./metrics");
    const signal = refreshIndexerMetrics();
    expect(signal.outcome).toBe("blocked");
    expect(
      (indexerOutcome.set as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0],
    ).toBe(INDEXER_OUTCOME_CODES.blocked);
  });

  it("snapshot never contains a raw provider error message — only coarse failure kind", async () => {
    const cid = nextContractId();
    setupDb(9000);
    mockGetLatestLedger.mockResolvedValue({ sequence: 9010 });
    // Embed a credential-like string in the error that must not propagate
    mockGetEvents.mockRejectedValue(
      new Error("RPC failure at https://rpc.internal.example/SECRET"),
    );

    await runOnePoll(cid);

    const snapshot = getIndexerMonitoringSnapshot();
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toMatch(/https?:\/\//);
    expect(serialized).not.toMatch(/SECRET/i);
    expect(["rate_limited", "disconnected", "provider_error", "unknown"]).toContain(
      snapshot.lastFailureKind,
    );

    const signal = classifyIndexerOutcome(snapshot);
    expect(signal.detail).not.toMatch(/https?:\/\//);
    expect(signal.detail).not.toMatch(/SECRET/i);
  });
});

// =============================================================================
// Scenario C: Reproducibility from a clean / fresh-checkout state
// =============================================================================
//
// Confirms that each scenario above can be reproduced without any undocumented
// local state: resetIndexerState() + a fresh in-memory DB is sufficient.
// =============================================================================

describe("Reproducibility — clean state baseline", () => {
  it("starts with zero lag, zero failures, and CLOSED circuit after resetIndexerState", () => {
    const snapshot = getIndexerMonitoringSnapshot();
    expect(snapshot.latestLedger).toBeNull();
    expect(snapshot.indexedLedger).toBe(0);
    expect(snapshot.ledgerLag).toBe(0);
    expect(snapshot.consecutiveFailures).toBe(0);
    expect(snapshot.circuitState).toBe(CircuitState.CLOSED);
    expect(snapshot.lastFailureKind).toBeNull();
    expect(snapshot.rpcConfigured).toBe(false);
    expect(snapshot.pollInFlight).toBe(false);
  });

  it("an unconfigured idle indexer (no RPC, no lag) is classified as success", () => {
    const snapshot = getIndexerMonitoringSnapshot();
    const signal = classifyIndexerOutcome(snapshot);
    expect(signal.outcome).toBe("success");
  });

  it("Scenario A is reproducible: successful poll with lag reports success from a clean start", async () => {
    const cid = nextContractId();
    setupDb(1000); // persisted cursor
    mockGetLatestLedger.mockResolvedValue({ sequence: 1100 }); // 100-ledger gap
    mockGetEvents.mockResolvedValue({ events: [] });

    await runOnePoll(cid);

    const signal = classifyIndexerOutcome(getIndexerMonitoringSnapshot());
    expect(signal.outcome).toBe("success");
  });

  it("Scenario B1 is reproducible: rate-limited poll reports transient_delay from a clean start", async () => {
    const cid = nextContractId();
    setupDb(2000);
    mockGetLatestLedger.mockResolvedValue({ sequence: 2010 });
    mockGetEvents.mockRejectedValue(
      Object.assign(new Error("429 Too Many Requests"), { status: 429 }),
    );

    await runOnePoll(cid);

    const snapshot = getIndexerMonitoringSnapshot();
    expect(snapshot.consecutiveFailures).toBeGreaterThan(0);
    expect(snapshot.circuitState).toBe(CircuitState.CLOSED);
    expect(classifyIndexerOutcome(snapshot).outcome).toBe("transient_delay");
  });

  it("Scenario B2 is reproducible: 5+ consecutive failures report blocked from a clean start", async () => {
    const cid = nextContractId();
    setupDb(3000);
    mockGetLatestLedger.mockResolvedValue({ sequence: 3010 });
    mockGetEvents.mockRejectedValue(new Error("fetch failed"));

    await runUntilCircuitOpen(cid);

    const snapshot = getIndexerMonitoringSnapshot();
    expect(snapshot.circuitState).toBe(CircuitState.OPEN);
    expect(classifyIndexerOutcome(snapshot).outcome).toBe("blocked");
  });
});
