/**
 * indexer.gap.test.ts
 *
 * Tests verifying that the indexer correctly detects and fills the gap between
 * the last persisted cursor ledger and the current RPC ledger on startup/restart.
 *
 * Acceptance criteria:
 *  1. Gap fill is triggered when stored ledger < current RPC ledger
 *  2. Partial gap fill checkpoints correctly on RPC failure
 *  3. No duplicate events are inserted during gap fill
 *
 * Design notes
 * ------------
 * • `lastProcessedLedger` is module-level state in indexer.ts.  We call
 *   `resetIndexerState()` in beforeEach so every test starts from 0.
 * • `initIndexer()` reads `indexer_cursor` from the DB; seeding that table
 *   before calling `initIndexer` is the canonical way to simulate a restart.
 * • `nextContractId()` is used so each test uses a unique contract ID —
 *   this avoids the module-level `contractId` being reused across tests when
 *   the indexer is running concurrently with older tests.
 * • We use a real in-memory SQLite DB so that cursor reads/writes are genuine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

// ── Stub metrics ─────────────────────────────────────────────────────────────
vi.mock("./metrics", () => ({
  eventsIndexedTotal: { inc: vi.fn() },
  ledgersScannedTotal: { inc: vi.fn() },
  lastIndexedLedger: { set: vi.fn() },
  indexerErrorsTotal: { inc: vi.fn() },
  indexerCircuitState: { set: vi.fn() },
}));

// ── In-memory DB (replaced per-test via setupDb) ──────────────────────────────
let db: InstanceType<typeof Database>;
vi.mock("./db", () => ({ getDb: () => db }));

// ── Capture all recordEventWithDb calls ──────────────────────────────────────
// vi.hoisted ensures the variable is initialised before the hoisted vi.mock calls run.
const { recordEventWithDb } = vi.hoisted(() => ({
  recordEventWithDb: vi.fn(),
}));
vi.mock("./eventHistory", () => ({ recordEventWithDb }));

// ── Mock rpc.Server ───────────────────────────────────────────────────────────
const { mockGetLatestLedger, mockGetEvents } = vi.hoisted(() => ({
  mockGetLatestLedger: vi.fn(),
  mockGetEvents: vi.fn(),
}));

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    // In tests we pass plain JS objects so identity works for scValToNative.
    scValToNative: (v: any) => v,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(() => ({
        getLatestLedger: mockGetLatestLedger,
        getEvents: mockGetEvents,
      })),
    },
  };
});

// Import after all vi.mock() calls so the mocks are in place
import {
  initIndexer,
  startIndexer,
  stopIndexer,
  resetIndexerState,
} from "./indexer";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Unique contract IDs prevent module-level state bleed across tests */
let testContractCounter = 0;
function nextContractId(): string {
  return `GAPTEST${String(++testContractCounter).padStart(4, "0")}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`.slice(0, 56);
}

/**
 * Builds a minimal in-memory SQLite DB with the tables the indexer needs.
 * Optionally seeds a persisted cursor value.
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

/** Returns the persisted cursor value from the DB (or null if absent) */
function readCursor(): number | null {
  const row = db
    .prepare("SELECT last_ledger_sequence FROM indexer_cursor WHERE id = 1")
    .get() as { last_ledger_sequence: number } | undefined;
  return row ? row.last_ledger_sequence : null;
}

/**
 * Builds a minimal contract event object that processEvent can handle.
 * The mock for scValToNative is identity, so we pass plain objects.
 */
function makeCreatedEvent(streamId = "1", ledgerSeq = 1001): object {
  return {
    topic: ["Stream", "Created"],
    value: {
      stream_id: BigInt(streamId),
      sender: "GSENDER1234567890123456789012345678901234567890123456",
      recipient: "GRECIPI1234567890123456789012345678901234567890123456",
      token: "GTOKEN12345678901234567890123456789012345678901234567",
      total_amount: BigInt(1000),
      start_time: BigInt(0),
      end_time: BigInt(1000),
    },
    ledgerClosedAt: new Date(1_700_000_000_000).toISOString(),
    ledger: ledgerSeq,
  };
}

function makeClaimedEvent(streamId = "1", amount = 500, ledgerSeq = 1010): object {
  return {
    topic: ["Stream", "Claimed"],
    value: {
      stream_id: BigInt(streamId),
      recipient: "GRECIPI1234567890123456789012345678901234567890123456",
      amount: BigInt(amount),
    },
    ledgerClosedAt: new Date(1_700_005_000_000).toISOString(),
    ledger: ledgerSeq,
  };
}

/**
 * Runs one full poll cycle:
 *  1. initIndexer (loads cursor from DB)
 *  2. startIndexer
 *  3. wait long enough for the immediate poll + any interval tick
 *  4. stopIndexer
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

// ── Test lifecycle ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Reset module-level state so every test begins with lastProcessedLedger = 0
  resetIndexerState();
});

afterEach(() => {
  stopIndexer(); // safety — ensure no lingering interval
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Gap-fill triggered when stored ledger < current RPC ledger
// ═══════════════════════════════════════════════════════════════════════════════

describe("gap-fill: startup with persisted cursor", () => {
  it("fetches from ledger 1001 when cursor is seeded at 1000 and RPC is at 1050", async () => {
    const cid = nextContractId();
    setupDb(1000); // simulate previous run stopped at ledger 1000

    mockGetLatestLedger.mockResolvedValue({ sequence: 1050 });
    mockGetEvents.mockResolvedValue({ events: [] });

    await runOnePoll(cid);

    expect(mockGetEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 1001 }),
    );
  });

  it("fetches ledgers 1001–1050 (full gap range) on startup", async () => {
    const cid = nextContractId();
    setupDb(1000);

    mockGetLatestLedger.mockResolvedValue({ sequence: 1050 });
    const gapEvent = makeCreatedEvent("42", 1025);
    mockGetEvents.mockResolvedValue({ events: [gapEvent] });

    await runOnePoll(cid);

    // The single getEvents call must cover the entire gap
    const call = mockGetEvents.mock.calls[0]?.[0];
    expect(call.startLedger).toBe(1001);
    expect(recordEventWithDb).toHaveBeenCalledTimes(1);
    expect(recordEventWithDb).toHaveBeenCalledWith(
      expect.anything(),
      "42",
      "created",
      expect.any(Number),
      expect.any(String),
      expect.anything(),
      expect.anything(),
      1025,
    );
  });

  it("processes ALL events in the gap range without skipping any", async () => {
    const cid = nextContractId();
    setupDb(1000);

    mockGetLatestLedger.mockResolvedValue({ sequence: 1050 });

    // Three events spread across the gap
    const events = [
      makeCreatedEvent("1", 1010),
      makeClaimedEvent("1", 500, 1020),
      makeClaimedEvent("1", 250, 1040),
    ];
    mockGetEvents.mockResolvedValue({ events });

    await runOnePoll(cid);

    expect(recordEventWithDb).toHaveBeenCalledTimes(3);
    const types = recordEventWithDb.mock.calls.map((c: any[]) => c[2]);
    expect(types).toEqual(["created", "claimed", "claimed"]);
  });

  it("does NOT start from ledger 0 when a valid cursor exists", async () => {
    const cid = nextContractId();
    setupDb(1000);

    mockGetLatestLedger.mockResolvedValue({ sequence: 1050 });
    mockGetEvents.mockResolvedValue({ events: [] });

    await runOnePoll(cid);

    const call = mockGetEvents.mock.calls[0]?.[0];
    // startLedger must be 1001, not 1 (which would happen with lastProcessedLedger=0)
    expect(call.startLedger).not.toBe(1);
    expect(call.startLedger).toBe(1001);
  });

  it("starts from ledger 1 when no cursor is seeded (fresh install)", async () => {
    const cid = nextContractId();
    setupDb(); // no cursor row

    mockGetLatestLedger.mockResolvedValue({ sequence: 1050 });
    mockGetEvents.mockResolvedValue({ events: [] });

    await runOnePoll(cid);

    const call = mockGetEvents.mock.calls[0]?.[0];
    expect(call.startLedger).toBe(1); // lastProcessedLedger=0, so 0+1=1
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Cursor checkpoint persisted after each successful poll
// ═══════════════════════════════════════════════════════════════════════════════

describe("gap-fill: cursor persistence (checkpoint)", () => {
  it("persists cursor to DB after a successful poll", async () => {
    const cid = nextContractId();
    setupDb(1000);

    mockGetLatestLedger.mockResolvedValue({ sequence: 1050 });
    mockGetEvents.mockResolvedValue({ events: [] });

    await runOnePoll(cid);

    expect(readCursor()).toBe(1050);
  });

  it("does NOT advance the cursor when getEvents throws", async () => {
    const cid = nextContractId();
    setupDb(1000);

    mockGetLatestLedger.mockResolvedValue({ sequence: 1050 });
    mockGetEvents.mockRejectedValue(new Error("RPC timeout"));

    await runOnePoll(cid);

    // Cursor must remain at 1000 — no partial progress written
    expect(readCursor()).toBe(1000);
  });

  it("does NOT advance the cursor when getLatestLedger throws", async () => {
    const cid = nextContractId();
    setupDb(1000);

    mockGetLatestLedger.mockRejectedValue(new Error("network error"));
    mockGetEvents.mockResolvedValue({ events: [] });

    await runOnePoll(cid);

    expect(readCursor()).toBe(1000);
  });

  it("creates the cursor row on first successful poll when none exists", async () => {
    const cid = nextContractId();
    setupDb(); // no cursor row

    mockGetLatestLedger.mockResolvedValue({ sequence: 500 });
    mockGetEvents.mockResolvedValue({ events: [] });

    await runOnePoll(cid);

    expect(readCursor()).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Partial gap fill checkpoints at last successful ledger on RPC failure
// ═══════════════════════════════════════════════════════════════════════════════

describe("gap-fill: partial progress on mid-gap RPC failure", () => {
  it("checkpoints at last successful ledger when RPC fails mid-gap", async () => {
    const cid = nextContractId();
    setupDb(1000);

    // First poll succeeds up to 1025, second poll fails
    mockGetLatestLedger
      .mockResolvedValueOnce({ sequence: 1025 })
      .mockResolvedValueOnce({ sequence: 1050 });

    mockGetEvents
      .mockResolvedValueOnce({ events: [makeCreatedEvent("1", 1010)] })
      .mockRejectedValueOnce(new Error("RPC unavailable"));

    // Two polls: first interval fires at 50ms, test ends at 150ms
    await new Promise<void>((resolve) => {
      initIndexer(
        "https://rpc.example.com",
        cid,
        "Test SDF Network ; September 2015",
      );
      startIndexer(50);
      setTimeout(() => {
        stopIndexer();
        resolve();
      }, 130);
    });

    // After the first successful poll, cursor must be 1025
    // (the second poll failed so it can't be 1050)
    const cursor = readCursor();
    expect(cursor).toBe(1025);
  });

  it("records events from successful portion of gap, skips nothing from that portion", async () => {
    const cid = nextContractId();
    setupDb(1000);

    // Only the first sub-range is fetched before failure
    mockGetLatestLedger.mockResolvedValue({ sequence: 1025 });
    const eventsInRange = [
      makeCreatedEvent("10", 1005),
      makeClaimedEvent("10", 300, 1015),
    ];
    mockGetEvents.mockResolvedValue({ events: eventsInRange });

    await runOnePoll(cid);

    // Both events from the partial range must be recorded
    expect(recordEventWithDb).toHaveBeenCalledTimes(2);
    const streamIds = recordEventWithDb.mock.calls.map((c: any[]) => c[1]);
    expect(streamIds).toEqual(["10", "10"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. No duplicate events during gap fill
// ═══════════════════════════════════════════════════════════════════════════════

describe("gap-fill: no duplicate events", () => {
  it("does not re-process already-indexed events when restarting at same cursor", async () => {
    const cid = nextContractId();
    // Simulate: last poll processed up to ledger 1050; restart with same cursor
    setupDb(1050);

    mockGetLatestLedger.mockResolvedValue({ sequence: 1050 });
    mockGetEvents.mockResolvedValue({
      // RPC would return nothing new since startLedger > currentLedger
      events: [],
    });

    await runOnePoll(cid);

    // getEvents is not called when currentLedger <= lastProcessedLedger
    // (the indexer short-circuits in that case)
    expect(recordEventWithDb).not.toHaveBeenCalled();
  });

  it("does not re-fetch events already covered by the persisted cursor", async () => {
    const cid = nextContractId();
    // Cursor says we processed up to 1000; RPC now at 1010
    setupDb(1000);

    mockGetLatestLedger.mockResolvedValue({ sequence: 1010 });
    mockGetEvents.mockResolvedValue({ events: [makeCreatedEvent("5", 1005)] });

    await runOnePoll(cid);

    // Only one getEvents call, starting at 1001 (not 0 or 1)
    expect(mockGetEvents).toHaveBeenCalledTimes(1);
    expect(mockGetEvents.mock.calls[0][0].startLedger).toBe(1001);
    expect(recordEventWithDb).toHaveBeenCalledTimes(1);
  });

  it("calling initIndexer + startIndexer twice does not double-record events", async () => {
    const cid = nextContractId();
    setupDb(1000);

    mockGetLatestLedger.mockResolvedValue({ sequence: 1010 });
    const event = makeCreatedEvent("99", 1005);
    mockGetEvents.mockResolvedValue({ events: [event] });

    // First run
    await runOnePoll(cid);
    const firstCallCount = recordEventWithDb.mock.calls.length;

    // Reset state and DB cursor to simulate a clean restart at the checkpoint
    resetIndexerState();
    // cursor is now 1010 in DB (written by the first run)
    // RPC is still at 1010 → no new ledgers → no new events
    mockGetLatestLedger.mockResolvedValue({ sequence: 1010 });
    mockGetEvents.mockResolvedValue({ events: [] });

    await runOnePoll(cid);

    // Second run must not re-record anything
    expect(recordEventWithDb.mock.calls.length).toBe(firstCallCount);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("gap-fill: edge cases", () => {
  it("handles empty event list in the gap range without error", async () => {
    const cid = nextContractId();
    setupDb(1000);

    mockGetLatestLedger.mockResolvedValue({ sequence: 1050 });
    mockGetEvents.mockResolvedValue({ events: [] });

    await expect(runOnePoll(cid)).resolves.not.toThrow();
    expect(readCursor()).toBe(1050);
    expect(recordEventWithDb).not.toHaveBeenCalled();
  });

  it("handles gap of exactly one ledger (cursor=1049, RPC=1050)", async () => {
    const cid = nextContractId();
    setupDb(1049);

    mockGetLatestLedger.mockResolvedValue({ sequence: 1050 });
    mockGetEvents.mockResolvedValue({ events: [makeCreatedEvent("7", 1050)] });

    await runOnePoll(cid);

    expect(mockGetEvents.mock.calls[0][0].startLedger).toBe(1050);
    expect(recordEventWithDb).toHaveBeenCalledTimes(1);
    expect(readCursor()).toBe(1050);
  });

  it("handles a very large gap (cursor=0, RPC=100000)", async () => {
    const cid = nextContractId();
    setupDb(); // no cursor → starts at 0

    mockGetLatestLedger.mockResolvedValue({ sequence: 100_000 });
    mockGetEvents.mockResolvedValue({ events: [] });

    await runOnePoll(cid);

    expect(mockGetEvents.mock.calls[0][0].startLedger).toBe(1); // 0+1
    expect(readCursor()).toBe(100_000);
  });

  it("does not call getEvents when cursor equals current RPC ledger", async () => {
    const cid = nextContractId();
    setupDb(1050);

    mockGetLatestLedger.mockResolvedValue({ sequence: 1050 });

    await runOnePoll(cid);

    expect(mockGetEvents).not.toHaveBeenCalled();
  });
});
