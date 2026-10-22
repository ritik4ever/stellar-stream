/**
 * indexer.backfill.test.ts
 *
 * Deterministic tests for Indexer backfill edge cases:
 * 1. First page at a configured start ledger (INDEXER_START_LEDGER)
 * 2. RPC truncating a page (cursor-based pagination across multiple pages)
 * 3. RPC delaying or failing a page mid-pagination (handling delays, preserving checkpoints, and ensuring absence of duplicate side effects)
 *
 * Batch ID: SSB-2026-150
 * Resolves #1093
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
  return `BACKFILLTEST${String(++testContractCounter).padStart(4, "0")}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`.slice(0, 56);
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
}> {
  return db
    .prepare("SELECT id, stream_id, event_type, ledger_sequence FROM stream_events ORDER BY id ASC")
    .all() as any[];
}

function makeStreamCreatedEvent(streamId: string | number, ledgerSeq: number): object {
  const numericId = typeof streamId === "number" ? streamId : (parseInt(streamId.replace(/\D/g, ""), 10) || 1);
  return {
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

function makeStreamClaimedEvent(streamId: string | number, amount: number, ledgerSeq: number): object {
  const numericId = typeof streamId === "number" ? streamId : (parseInt(streamId.replace(/\D/g, ""), 10) || 1);
  return {
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
  resetIndexerState();
});

afterEach(() => {
  stopIndexer();
  delete process.env.INDEXER_START_LEDGER;
  resetIndexerState();
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. First Page at a Configured Start Ledger
// ═══════════════════════════════════════════════════════════════════════════════

describe("Indexer backfill: first page at a configured start ledger", () => {
  it("requests startLedger equal to INDEXER_START_LEDGER on the first page when DB is empty", async () => {
    const cid = nextContractId();
    setupDb(); // No cursor in DB
    process.env.INDEXER_START_LEDGER = "1000";

    mockGetLatestLedger.mockResolvedValue({ sequence: 1050 });
    const event1000 = makeStreamCreatedEvent("stream-1", 1000);
    const event1025 = makeStreamClaimedEvent("stream-1", 500, 1025);
    mockGetEvents.mockResolvedValue({ events: [event1000, event1025] });

    await runOnePoll(cid);

    // Verify first request to RPC getEvents includes the exact configured start ledger
    expect(mockGetEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 1000 }),
    );

    // Verify stored persisted backfill checkpoint advances to latest ledger
    expect(readCursor()).toBe(1050);

    // Verify events from the configured start ledger and beyond are persisted
    const storedEvents = getStoredEvents();
    expect(storedEvents).toHaveLength(2);
    expect(storedEvents[0].ledger_sequence).toBe(1000);
    expect(storedEvents[0].stream_id).toBe("1");
    expect(storedEvents[0].event_type).toBe("created");
    expect(storedEvents[1].ledger_sequence).toBe(1025);
    expect(storedEvents[1].event_type).toBe("claimed");

    // Verify absence of duplicate side effects: subsequent normal poll with saved checkpoint
    delete process.env.INDEXER_START_LEDGER;
    mockGetEvents.mockClear();
    await runOnePoll(cid);
    expect(mockGetEvents).not.toHaveBeenCalled();
    expect(getStoredEvents()).toHaveLength(2);
  });

  it("applies INDEXER_START_LEDGER override to rewind/re-index even when DB has a later cursor", async () => {
    const cid = nextContractId();
    // Simulate DB previously indexed up to ledger 2000
    setupDb(2000);
    // Operator configures backfill override from ledger 1500
    process.env.INDEXER_START_LEDGER = "1500";

    mockGetLatestLedger.mockResolvedValue({ sequence: 2050 });
    const backfillEvent = makeStreamCreatedEvent("stream-backfill", 1500);
    mockGetEvents.mockResolvedValue({ events: [backfillEvent] });

    await runOnePoll(cid);

    // Verify startLedger requested is 1500
    expect(mockGetEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 1500 }),
    );

    // Checkpoint advances to latest RPC ledger
    expect(readCursor()).toBe(2050);

    // Backfilled event is persisted
    const stored = getStoredEvents();
    expect(stored).toHaveLength(1);
    expect(stored[0].ledger_sequence).toBe(1500);
    expect(stored[0].stream_id).toBe("1");
  });

  it("handles multi-page backfill starting from configured start ledger", async () => {
    const cid = nextContractId();
    setupDb();
    process.env.INDEXER_START_LEDGER = "500";

    mockGetLatestLedger.mockResolvedValue({ sequence: 600 });

    const page1Event = makeStreamCreatedEvent("stream-p1", 500);
    const page2Event = makeStreamClaimedEvent("stream-p1", 200, 550);

    mockGetEvents
      .mockResolvedValueOnce({ events: [page1Event], cursor: "cursor-token-page-2" })
      .mockResolvedValueOnce({ events: [page2Event], cursor: undefined });

    await runOnePoll(cid);

    // Page 1 asked for startLedger: 500
    expect(mockGetEvents).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ startLedger: 500 }),
    );

    // Page 2 asked with cursor: "cursor-token-page-2"
    expect(mockGetEvents).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: "cursor-token-page-2" }),
    );

    // Both events stored
    const stored = getStoredEvents();
    expect(stored).toHaveLength(2);
    expect(stored.map((e) => e.ledger_sequence)).toEqual([500, 550]);

    // Checkpoint matches latest ledger
    expect(readCursor()).toBe(600);
  });

  it("handles empty event response on first page at configured start ledger", async () => {
    const cid = nextContractId();
    setupDb();
    process.env.INDEXER_START_LEDGER = "2500";

    mockGetLatestLedger.mockResolvedValue({ sequence: 2600 });
    mockGetEvents.mockResolvedValue({ events: [] });

    await runOnePoll(cid);

    expect(mockGetEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 2500 }),
    );
    expect(readCursor()).toBe(2600);
    expect(getStoredEvents()).toHaveLength(0);
  });

  it("preserves persisted cursor when INDEXER_START_LEDGER=0 (special case: no override)", async () => {
    const cid = nextContractId();
    setupDb(1200);
    process.env.INDEXER_START_LEDGER = "0";

    mockGetLatestLedger.mockResolvedValue({ sequence: 1250 });
    mockGetEvents.mockResolvedValue({ events: [] });

    await runOnePoll(cid);

    // Preserved cursor is 1200, so startLedger is 1200 + 1 = 1201
    expect(mockGetEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 1201 }),
    );
    expect(readCursor()).toBe(1250);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. RPC Truncating a Page (Cursor Pagination)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Indexer backfill: RPC truncating a page", () => {
  it("paginates sequentially when RPC truncates responses across 3 pages", async () => {
    const cid = nextContractId();
    setupDb(100);

    mockGetLatestLedger.mockResolvedValue({ sequence: 200 });

    const ev1 = makeStreamCreatedEvent("stream-a", 110);
    const ev2 = makeStreamCreatedEvent("stream-b", 120);
    const ev3 = makeStreamClaimedEvent("stream-a", 100, 150);

    mockGetEvents
      .mockResolvedValueOnce({ events: [ev1], cursor: "cursor-page-2" })
      .mockResolvedValueOnce({ events: [ev2], cursor: "cursor-page-3" })
      .mockResolvedValueOnce({ events: [ev3], cursor: undefined });

    await runOnePoll(cid);

    expect(mockGetEvents).toHaveBeenCalledTimes(3);
    expect(mockGetEvents.mock.calls[0][0]).toMatchObject({ startLedger: 101 });
    expect(mockGetEvents.mock.calls[1][0]).toMatchObject({ cursor: "cursor-page-2" });
    expect(mockGetEvents.mock.calls[2][0]).toMatchObject({ cursor: "cursor-page-3" });

    // Stored events match in exact sequence
    const stored = getStoredEvents();
    expect(stored).toHaveLength(3);
    expect(stored.map((e) => e.ledger_sequence)).toEqual([110, 120, 150]);

    // Persisted checkpoint matches current ledger
    expect(readCursor()).toBe(200);

    // Metrics tracking
    expect(mockEventsIndexedTotal.inc).toHaveBeenCalledTimes(3);
  });

  it("advances checkpoint to max ledger seen if events exceed latest RPC ledger sequence", async () => {
    const cid = nextContractId();
    setupDb(100);

    // RPC reported latest ledger as 150, but returned events up to ledger 160
    mockGetLatestLedger.mockResolvedValue({ sequence: 150 });
    const event160 = makeStreamCreatedEvent("stream-ahead", 160);
    mockGetEvents.mockResolvedValue({ events: [event160] });

    await runOnePoll(cid);

    expect(readCursor()).toBe(160);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. RPC Delaying or Failing a Page Mid-Pagination
// ═══════════════════════════════════════════════════════════════════════════════

describe("Indexer backfill: RPC delaying or failing a page", () => {
  it("prevents overlapping polls when an RPC request is delayed past the poll interval", async () => {
    const cid = nextContractId();
    setupDb(100);

    mockGetLatestLedger.mockResolvedValue({ sequence: 200 });

    // Simulate delayed RPC response: takes 80ms to respond
    mockGetEvents.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({ events: [makeStreamCreatedEvent("stream-slow", 150)] });
          }, 80);
        }),
    );

    // Start indexer with a very tight 20ms interval
    initIndexer("https://rpc.example.com", cid, "Test SDF Network ; September 2015");
    startIndexer(20);

    // During the in-flight delayed request, check snapshot
    await new Promise((r) => setTimeout(r, 30));
    const snapshot = getIndexerMonitoringSnapshot();
    expect(snapshot.pollInFlight).toBe(true);

    // Wait until the delayed call completes and timer stops
    await new Promise((r) => setTimeout(r, 120));
    stopIndexer();

    // Verify exactly 1 call was completed during the slow period, no overlapping re-entrancy
    const stored = getStoredEvents();
    expect(stored).toHaveLength(1);
    expect(stored[0].stream_id).toBe("1");
    expect(readCursor()).toBe(200);
  });

  it("preserves checkpoint and avoids duplicate side effects when RPC fails mid-gap on page 2", async () => {
    const cid = nextContractId();
    setupDb(1000);

    mockGetLatestLedger.mockResolvedValue({ sequence: 1050 });

    const page1Event = makeStreamCreatedEvent("stream-recovery", 1010);
    const page2Event = makeStreamClaimedEvent("stream-recovery", 250, 1030);

    // Run 1: Page 1 succeeds, Page 2 fails with 504 Gateway Timeout
    mockGetEvents
      .mockResolvedValueOnce({ events: [page1Event], cursor: "page-2-cursor" })
      .mockRejectedValue(
        Object.assign(new Error("504 Gateway Timeout"), { status: 504 }),
      );

    await runOnePoll(cid);

    // The checkpoint in DB must NOT advance — must remain at 1000
    expect(readCursor()).toBe(1000);

    // Circuit breaker and error metric recorded
    expect(mockIndexerErrorsTotal.inc).toHaveBeenCalled();
    const snapshot = getIndexerMonitoringSnapshot();
    expect(snapshot.lastFailureKind).toBe("disconnected");

    // Page 1 event was recorded into stream_events
    expect(getStoredEvents()).toHaveLength(1);

    // Run 2: RPC recovers and re-serves page 1 and page 2
    mockGetEvents.mockReset();
    mockGetLatestLedger.mockResolvedValue({ sequence: 1050 });
    mockGetEvents
      .mockResolvedValueOnce({ events: [page1Event], cursor: "page-2-cursor" })
      .mockResolvedValueOnce({ events: [page2Event], cursor: undefined });

    await runOnePoll(cid);

    // Persisted checkpoint now successfully advances to 1050
    expect(readCursor()).toBe(1050);

    // ABSENCE OF DUPLICATE SIDE EFFECTS:
    // Page 1 event must NOT be duplicated in stream_events
    const allEvents = getStoredEvents();
    expect(allEvents).toHaveLength(2);
    expect(allEvents[0].ledger_sequence).toBe(1010);
    expect(allEvents[0].event_type).toBe("created");
    expect(allEvents[1].ledger_sequence).toBe(1030);
    expect(allEvents[1].event_type).toBe("claimed");
  });
});
