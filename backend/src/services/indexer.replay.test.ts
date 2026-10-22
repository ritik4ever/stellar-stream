/**
 * indexer.replay.test.ts
 *
 * Deterministic tests for Soroban event indexer workflow reviewing:
 * 1. Replayed event pages (RPC re-serving previous pages or cursor overlapping)
 * 2. Identical event IDs (duplicate contract events with identical attributes or identifiers)
 * 3. Process restart after row insert but before cursor commit
 *
 * Project area: backend · Batch ID: SSB-2026-145
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

// ── Mock Metrics ─────────────────────────────────────────────────────────────
const {
  mockLastIndexedLedger,
  mockIndexerLatestLedger,
  mockIndexerLedgerLag,
  mockEventsIndexedTotal,
  mockLedgersScannedTotal,
  mockIndexerErrorsTotal,
  mockIndexerCircuitState,
} = vi.hoisted(() => ({
  mockLastIndexedLedger: { set: vi.fn() },
  mockIndexerLatestLedger: { set: vi.fn() },
  mockIndexerLedgerLag: { set: vi.fn() },
  mockEventsIndexedTotal: { inc: vi.fn() },
  mockLedgersScannedTotal: { inc: vi.fn() },
  mockIndexerErrorsTotal: { inc: vi.fn() },
  mockIndexerCircuitState: { set: vi.fn() },
}));

vi.mock("./metrics", () => ({
  eventsIndexedTotal: mockEventsIndexedTotal,
  ledgersScannedTotal: mockLedgersScannedTotal,
  lastIndexedLedger: mockLastIndexedLedger,
  indexerLatestLedger: mockIndexerLatestLedger,
  indexerLedgerLag: mockIndexerLedgerLag,
  indexerErrorsTotal: mockIndexerErrorsTotal,
  indexerCircuitState: mockIndexerCircuitState,
  indexerEventsDedupedTotal: { inc: vi.fn() },
  indexerPollDurationMs: { set: vi.fn() },
}));

// ── In-Memory SQLite DB Double ───────────────────────────────────────────────
let db: InstanceType<typeof Database>;
vi.mock("./db", () => ({ getDb: () => db }));

// ── Mock rpc.Server ──────────────────────────────────────────────────────────
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

import {
  initIndexer,
  startIndexer,
  stopIndexer,
  resetIndexerState,
  getIndexerMonitoringSnapshot,
} from "./indexer";

// ── Test Helpers ─────────────────────────────────────────────────────────────
let testContractCounter = 0;
function nextContractId(): string {
  return `REPLAYTEST${String(++testContractCounter).padStart(4, "0")}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`.slice(0, 56);
}

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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_events_dedup
      ON stream_events(stream_id, event_type, ledger_sequence)
      WHERE ledger_sequence IS NOT NULL;

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

function readCursor(): number | null {
  const row = db
    .prepare("SELECT last_ledger_sequence FROM indexer_cursor WHERE id = 1")
    .get() as { last_ledger_sequence: number } | undefined;
  return row ? row.last_ledger_sequence : null;
}

function getStoredEvents(): Array<{
  id: number;
  stream_id: string;
  event_type: string;
  ledger_sequence: number;
  amount: number | null;
  actor: string | null;
}> {
  return db
    .prepare("SELECT id, stream_id, event_type, ledger_sequence, amount, actor FROM stream_events ORDER BY id ASC")
    .all() as any[];
}

function makeStreamCreatedEvent(streamId: string | number, ledgerSeq: number, id?: string): object {
  const numericId = typeof streamId === "number" ? streamId : (parseInt(streamId.replace(/\D/g, ""), 10) || 1);
  return {
    id: id ?? `event-${numericId}-${ledgerSeq}-created`,
    topic: ["Stream", "Created"],
    value: {
      stream_id: BigInt(numericId),
      sender: "GSENDER1111111111111111111111111111111111111111111111111111",
      recipient: "GRECIPI1111111111111111111111111111111111111111111111111111",
      token: "GTOKEN11111111111111111111111111111111111111111111111111111",
      total_amount: BigInt(10_000),
      start_time: BigInt(1_700_000_000),
      end_time: BigInt(1_700_100_000),
    },
    ledgerClosedAt: new Date(1_700_000_000_000).toISOString(),
    ledger: ledgerSeq,
  };
}

function makeStreamClaimedEvent(streamId: string | number, amount: number, ledgerSeq: number, id?: string): object {
  const numericId = typeof streamId === "number" ? streamId : (parseInt(streamId.replace(/\D/g, ""), 10) || 1);
  return {
    id: id ?? `event-${numericId}-${ledgerSeq}-claimed`,
    topic: ["Stream", "Claimed"],
    value: {
      stream_id: BigInt(numericId),
      recipient: "GRECIPI1111111111111111111111111111111111111111111111111111",
      amount: BigInt(amount),
    },
    ledgerClosedAt: new Date(1_700_005_000_000).toISOString(),
    ledger: ledgerSeq,
  };
}

async function runOnePoll(contractId: string, pollIntervalMs = 5000, durationMs = 80): Promise<void> {
  initIndexer("https://rpc.example.com", contractId, "Test SDF Network ; September 2015");
  return new Promise<void>((resolve) => {
    startIndexer(pollIntervalMs);
    setTimeout(() => {
      stopIndexer();
      resolve();
    }, durationMs);
  });
}

// ── Test Lifecycle ───────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.INDEXER_START_LEDGER;
  delete process.env.INDEXER_FALLBACK_POLLING_ENABLED;
  resetIndexerState();
});

afterEach(() => {
  stopIndexer();
  delete process.env.INDEXER_START_LEDGER;
  delete process.env.INDEXER_FALLBACK_POLLING_ENABLED;
  resetIndexerState();
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Replayed Event Pages
// ═══════════════════════════════════════════════════════════════════════════════

describe("Soroban event indexer workflow: replayed event pages", () => {
  it("safely ignores replayed pages on subsequent polls without duplicating rows in cursor pagination", async () => {
    const cid = nextContractId();
    setupDb(100);

    mockGetLatestLedger.mockResolvedValue({ sequence: 120 });
    const event105 = makeStreamCreatedEvent("1", 105);
    const event110 = makeStreamClaimedEvent("1", 200, 110);

    // Initial poll returns page with events 105 and 110
    mockGetEvents.mockResolvedValueOnce({
      events: [event105, event110],
      cursor: undefined,
    });

    await runOnePoll(cid);

    expect(readCursor()).toBe(120);
    const initialStored = getStoredEvents();
    expect(initialStored).toHaveLength(2);

    // Next poll: RPC replays the same page (e.g. from an operator rewind or ledger range query)
    mockGetLatestLedger.mockResolvedValue({ sequence: 130 });
    mockGetEvents.mockReset();
    mockGetEvents.mockResolvedValueOnce({
      events: [event105, event110],
      cursor: undefined,
    });

    await runOnePoll(cid);

    // Stored cursor advances to latest
    expect(readCursor()).toBe(130);

    // No duplicate side effects: rows in DB remain exactly 2
    const postReplayStored = getStoredEvents();
    expect(postReplayStored).toHaveLength(2);
    expect(postReplayStored.map((e) => e.ledger_sequence)).toEqual([105, 110]);

    // Monitoring status and metrics confirm success
    const snapshot = getIndexerMonitoringSnapshot();
    expect(snapshot.indexedLedger).toBe(130);
    expect(snapshot.lastFailureKind).toBeNull();
    expect(snapshot.consecutiveFailures).toBe(0);
  });

  it("handles replayed pages across multi-page cursor pagination without duplicate rows", async () => {
    const cid = nextContractId();
    setupDb(1000);

    mockGetLatestLedger.mockResolvedValue({ sequence: 1050 });
    const page1Event = makeStreamCreatedEvent("2", 1010);
    const page2Event = makeStreamClaimedEvent("2", 500, 1020);

    // First cycle: 2 pages
    mockGetEvents
      .mockResolvedValueOnce({ events: [page1Event], cursor: "page-1-cursor" })
      .mockResolvedValueOnce({ events: [page2Event], cursor: undefined });

    await runOnePoll(cid);

    expect(readCursor()).toBe(1050);
    expect(getStoredEvents()).toHaveLength(2);

    // Second cycle: simulate RPC replaying page 1 and page 2 again (e.g., node cache replay)
    mockGetEvents.mockReset();
    mockGetLatestLedger.mockResolvedValue({ sequence: 1060 });
    mockGetEvents
      .mockResolvedValueOnce({ events: [page1Event], cursor: "page-1-cursor" })
      .mockResolvedValueOnce({ events: [page2Event], cursor: undefined });

    await runOnePoll(cid);

    expect(readCursor()).toBe(1060);
    const stored = getStoredEvents();
    expect(stored).toHaveLength(2);
    expect(stored[0].event_type).toBe("created");
    expect(stored[1].event_type).toBe("claimed");
  });

  it("safely ignores replayed event pages in fallback polling mode", async () => {
    process.env.INDEXER_FALLBACK_POLLING_ENABLED = "true";
    const cid = nextContractId();
    setupDb(200);

    mockGetLatestLedger.mockResolvedValue({ sequence: 250 });
    const event210 = makeStreamCreatedEvent("3", 210);

    mockGetEvents.mockResolvedValue({ events: [event210] });

    await runOnePoll(cid);

    expect(readCursor()).toBe(250);
    expect(getStoredEvents()).toHaveLength(1);

    // Replay same event on higher ledger
    mockGetLatestLedger.mockResolvedValue({ sequence: 260 });
    await runOnePoll(cid);

    expect(readCursor()).toBe(260);
    const stored = getStoredEvents();
    expect(stored).toHaveLength(1);
    expect(stored[0].stream_id).toBe("3");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Identical Event IDs and Duplicate Contract Events
// ═══════════════════════════════════════════════════════════════════════════════

describe("Soroban event indexer workflow: identical event IDs and duplicate events", () => {
  it("deduplicates identical events within the same page response", async () => {
    const cid = nextContractId();
    setupDb(500);

    mockGetLatestLedger.mockResolvedValue({ sequence: 550 });

    // RPC returns two events with identical ID, stream ID, event type, and ledger sequence in the same batch
    const event = makeStreamCreatedEvent("4", 510, "evt-identical-001");
    const duplicateEvent = makeStreamCreatedEvent("4", 510, "evt-identical-001");

    mockGetEvents.mockResolvedValueOnce({
      events: [event, duplicateEvent],
      cursor: undefined,
    });

    await runOnePoll(cid);

    expect(readCursor()).toBe(550);
    const stored = getStoredEvents();
    // Only one row inserted in database
    expect(stored).toHaveLength(1);
    expect(stored[0].stream_id).toBe("4");
    expect(stored[0].ledger_sequence).toBe(510);
    expect(stored[0].event_type).toBe("created");
  });

  it("handles identical event IDs appearing across consecutive pages in cursor pagination", async () => {
    const cid = nextContractId();
    setupDb(600);

    mockGetLatestLedger.mockResolvedValue({ sequence: 650 });

    const sharedEvent = makeStreamClaimedEvent("5", 150, 615, "evt-boundary-999");

    // Page 1 ends with sharedEvent, Page 2 begins with duplicate of sharedEvent (common in cursor boundary overlaps)
    mockGetEvents
      .mockResolvedValueOnce({ events: [sharedEvent], cursor: "overlap-cursor" })
      .mockResolvedValueOnce({ events: [sharedEvent], cursor: undefined });

    await runOnePoll(cid);

    expect(readCursor()).toBe(650);
    const stored = getStoredEvents();
    expect(stored).toHaveLength(1);
    expect(stored[0].stream_id).toBe("5");
    expect(stored[0].amount).toBe(150);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Process Restart Between Cursor Write and Row Insert
// ═══════════════════════════════════════════════════════════════════════════════

describe("Soroban event indexer workflow: process restart around cursor commit", () => {
  it("replays safely after event rows commit but the cursor write fails", async () => {
    const cid = nextContractId();
    setupDb(700);

    const event720 = makeStreamCreatedEvent("6", 720);
    const event730 = makeStreamClaimedEvent("6", 300, 730);
    db.exec(`
      CREATE TRIGGER fail_indexer_cursor_update
      BEFORE UPDATE ON indexer_cursor
      BEGIN
        SELECT RAISE(ABORT, 'simulated checkpoint write failure');
      END;
    `);

    mockGetLatestLedger.mockResolvedValue({ sequence: 750 });
    mockGetEvents.mockResolvedValueOnce({ events: [event720, event730], cursor: undefined });

    // The page commits first. A failed checkpoint write leaves the durable cursor stale.
    await runOnePoll(cid);
    expect(readCursor()).toBe(700);
    expect(getStoredEvents()).toHaveLength(2);

    // Simulate a process restart and repair the transient checkpoint storage failure.
    resetIndexerState();
    db.exec("DROP TRIGGER fail_indexer_cursor_update");
    mockGetEvents.mockResolvedValueOnce({
      events: [event720, event730],
      cursor: undefined,
    });

    await runOnePoll(cid);

    // Cursor successfully updates to 750
    expect(readCursor()).toBe(750);

    // Absence of duplicate side effects: event720 is NOT duplicated, and event730 is added
    const stored = getStoredEvents();
    expect(stored).toHaveLength(2);
    expect(stored[0].ledger_sequence).toBe(720);
    expect(stored[0].event_type).toBe("created");
    expect(stored[1].ledger_sequence).toBe(730);
    expect(stored[1].event_type).toBe("claimed");

    // Status and monitoring snapshot
    const snapshot = getIndexerMonitoringSnapshot();
    expect(snapshot.indexedLedger).toBe(750);
    expect(snapshot.lastFailureKind).toBeNull();

    // Structured outcome signal: restart-recovery poll must be distinguishable
    // from a normal empty poll so operators can correlate log lines via pollCycleId.
    expect(snapshot.lastPollOutcome).toBe("restart_recovery");
    expect(snapshot.lastPollDurationMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.pollCycleId).toBeGreaterThan(0);
  });

  it("recovers safely if crash/restart occurs after cursor write (empty row window)", async () => {
    const cid = nextContractId();
    // Simulate scenario where cursor was written up to 850 (e.g. empty block or previous batch committed)
    setupDb(850);

    // On restart, indexer loads checkpoint 850
    initIndexer("https://rpc.example.com", cid, "Test SDF Network ; September 2015");

    const snapshotBefore = getIndexerMonitoringSnapshot();
    expect(snapshotBefore.indexedLedger).toBe(850);

    // Latest ledger is 860, no events in 851..860
    mockGetLatestLedger.mockResolvedValue({ sequence: 860 });
    mockGetEvents.mockResolvedValueOnce({ events: [], cursor: undefined });

    await new Promise<void>((resolve) => {
      startIndexer(5000);
      setTimeout(() => {
        stopIndexer();
        resolve();
      }, 80);
    });

    expect(readCursor()).toBe(860);
    expect(getStoredEvents()).toHaveLength(0);

    // A "cursor-written, no rows" restart scenario: cursor was advanced, no
    // rows beyond it. The poll should be classified as normal_empty (cursor ==
    // latest ledger after our empty-range poll advances it) or empty_range —
    // either way it must NOT be restart_recovery (there are no pre-existing
    // rows ahead of the cursor on restart).
    const snapshot = getIndexerMonitoringSnapshot();
    expect(snapshot.lastPollOutcome).not.toBe("restart_recovery");
    expect(snapshot.lastPollDurationMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.pollCycleId).toBeGreaterThan(0);
  });

  it("emits a normal_empty outcome signal (not restart_recovery) when the checkpoint equals the latest ledger on startup", async () => {
    const cid = nextContractId();
    // Cursor exactly at the latest RPC ledger — nothing to process.
    setupDb(1000);
    mockGetLatestLedger.mockResolvedValue({ sequence: 1000 });

    await runOnePoll(cid);

    const snapshot = getIndexerMonitoringSnapshot();
    expect(snapshot.lastPollOutcome).toBe("normal_empty");
    expect(snapshot.lastPollDurationMs).toBeGreaterThanOrEqual(0);
    // pollCycleId must be > 0 so log lines can be linked to this specific poll.
    expect(snapshot.pollCycleId).toBeGreaterThan(0);
    // The restart-recovery path must NOT fire for a clean idle state.
    expect(snapshot.indexedLedger).toBe(1000);
    expect(snapshot.lastFailureKind).toBeNull();
  });

  it("emits distinct pollCycleIds across consecutive polls so operators can link log lines per cycle", async () => {
    const cid = nextContractId();
    setupDb(100);

    let pollCount = 0;
    mockGetLatestLedger.mockImplementation(async () => ({ sequence: 100 + ++pollCount * 10 }));
    mockGetEvents.mockResolvedValue({ events: [] });

    // Run two separate poll cycles by driving the indexer for two intervals.
    await new Promise<void>((resolve) => {
      initIndexer("https://rpc.example.com", cid, "Test SDF Network ; September 2015");
      startIndexer(30);
      setTimeout(() => { stopIndexer(); resolve(); }, 120);
    });

    const snapshot = getIndexerMonitoringSnapshot();
    // At least two polls fired — pollCycleId must be >= 2.
    expect(snapshot.pollCycleId).toBeGreaterThanOrEqual(2);
  });

  it("rolls back a page and leaves the cursor retryable when an event cannot be stored", async () => {
    const cid = nextContractId();
    setupDb(900);

    mockGetLatestLedger.mockResolvedValue({ sequence: 950 });

    const validEvent = makeStreamCreatedEvent("7", 910);
    const corruptEvent = {
      topic: ["Stream", "Created"],
      // Corrupt payload causing recordEvent to throw if schema constraint fails or unexpected error
      value: { stream_id: { toString: () => { throw new Error("corrupt stream value"); } } },
      ledgerClosedAt: new Date(1_700_000_000_000).toISOString(),
      ledger: 920,
    };

    // Event processing errors must escape the page transaction instead of being swallowed.
    mockGetEvents.mockResolvedValueOnce({
      events: [validEvent, corruptEvent as any],
      cursor: undefined,
    });

    await runOnePoll(cid);

    expect(readCursor()).toBe(900);
    expect(getStoredEvents()).toHaveLength(0);

    // A later retry can process the valid event and advance the cursor.
    mockGetEvents.mockResolvedValueOnce({ events: [validEvent], cursor: undefined });
    await runOnePoll(cid);

    expect(readCursor()).toBe(950);
    const stored = getStoredEvents();
    expect(stored).toHaveLength(1);
    expect(stored[0].stream_id).toBe("7");
  });
});
