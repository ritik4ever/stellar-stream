/**
 * Unit tests for indexer processEvent — verifies StreamClaimed events
 * are correctly parsed and recorded into event_history.
 * Issue #144: Record claimed events when contract emits StreamClaimed
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

// ── Stub metrics ──────────────────────────────────────────────────────────
vi.mock("./metrics", () => ({
  eventsIndexedTotal:  { inc: vi.fn() },
  ledgersScannedTotal: { inc: vi.fn() },
  lastIndexedLedger:   { set: vi.fn() },
  indexerErrorsTotal:  { inc: vi.fn() },
  indexerCircuitState: { set: vi.fn() },
}));

// ── In-memory DB ──────────────────────────────────────────────────────────
let db: InstanceType<typeof Database>;
vi.mock("./db", () => ({ getDb: () => db }));

// ── Spy on recordEventWithDb ──────────────────────────────────────────────
const recordEventWithDb = vi.fn();
vi.mock("./eventHistory", () => ({ recordEventWithDb }));

// ── Mock rpc.Server at module level ──────────────────────────────────────
let mockGetLatestLedger = vi.fn();
let mockGetEvents = vi.fn();

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    // scValToNative is called on topic items and event.value in processEvent.
    // In tests we pass already-decoded plain JS values, so identity is correct.
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

// Import after all mocks are registered
const { initIndexer, startIndexer, stopIndexer } = require("./indexer");

// ── Helpers ───────────────────────────────────────────────────────────────

function makeClaimedEvent(opts: {
  streamId?: string | number;
  recipient?: string;
  amount?: number;
  ledgerClosedAt?: string;
} = {}) {
  const {
    streamId = "42",
    recipient = "GRECIPI1234567890123456789012345678901234567890123456",
    amount = 500,
    ledgerClosedAt = new Date(1_700_000_000_000).toISOString(),
  } = opts;
  return {
    topic: ["Stream", "Claimed"],
    value: { stream_id: BigInt(streamId), recipient, amount: BigInt(amount) },
    ledgerClosedAt,
  };
}

function makeCreatedEvent() {
  return {
    topic: ["Stream", "Created"],
    value: {
      stream_id: BigInt(1),
      sender: "GSENDER1234567890123456789012345678901234567890123456",
      recipient: "GRECIPI1234567890123456789012345678901234567890123456",
      token: "GTOKEN12345678901234567890123456789012345678901234567",
      total_amount: BigInt(1000),
      start_time: BigInt(0),
      end_time: BigInt(1000),
    },
    ledgerClosedAt: new Date(1_700_000_000_000).toISOString(),
  };
}

// Use a unique contract ID per test to avoid module-level lastProcessedLedger state bleed
let testContractCounter = 0;
function nextContractId() {
  return `CONTRACT${String(++testContractCounter).padStart(3, "0")}`;
}

function setupDb(contractId: string, lastLedger = 100) {
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
  db.prepare("INSERT INTO indexer_cursor (id, last_ledger_sequence) VALUES (1, ?)").run(lastLedger);
}

async function runOnePoll(contractId: string) {
  initIndexer("https://rpc.example.com", contractId, "Test SDF Network ; September 2015");
  await new Promise<void>((resolve) => {
    startIndexer(50);
    setTimeout(() => { stopIndexer(); resolve(); }, 150);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────
describe("indexer processEvent — StreamClaimed", () => {
  let ledgerSeq = 200;

  beforeEach(() => {
    vi.clearAllMocks();
    ledgerSeq += 200; // always higher than any previous lastProcessedLedger
    mockGetLatestLedger.mockResolvedValue({ sequence: ledgerSeq });
  });

  it("calls recordEventWithDb with type='claimed', recipient as actor, and amount", async () => {
    const cid = nextContractId();
    setupDb(cid, ledgerSeq - 100);
    const event = makeClaimedEvent({ streamId: "7", recipient: "GRECIPI1234567890123456789012345678901234567890123456", amount: 250 });
    mockGetEvents.mockResolvedValue({ events: [event] });

    await runOnePoll(cid);

    expect(recordEventWithDb).toHaveBeenCalledWith(
      expect.anything(),
      "7",
      "claimed",
      Math.floor(new Date(event.ledgerClosedAt).getTime() / 1000),
      event.value.recipient,
      event.value.amount,
      undefined,
      undefined,
    );
  });

  it("records claimed event after created event in the same poll", async () => {
    const cid = nextContractId();
    setupDb(cid, ledgerSeq - 100);
    const created = makeCreatedEvent();
    const claimed = makeClaimedEvent({ streamId: "1", amount: 300 });
    mockGetEvents.mockResolvedValue({ events: [created, claimed] });

    await runOnePoll(cid);

    const calls = recordEventWithDb.mock.calls;
    const createdCall = calls.find((c: any[]) => c[2] === "created");
    const claimedCall = calls.find((c: any[]) => c[2] === "claimed");

    expect(createdCall).toBeDefined();
    expect(claimedCall).toBeDefined();
    expect(claimedCall[4]).toBe(claimed.value.recipient);
    expect(claimedCall[5]).toBe(claimed.value.amount);
  });

  it("does not call recordEventWithDb for a malformed Claimed event (null value)", async () => {
    const cid = nextContractId();
    setupDb(cid, ledgerSeq - 100);
    const badEvent = {
      topic: ["Stream", "Claimed"],
      value: null,
      ledgerClosedAt: new Date().toISOString(),
    };
    mockGetEvents.mockResolvedValue({ events: [badEvent] });

    await runOnePoll(cid);

    const claimedCall = recordEventWithDb.mock.calls.find((c: any[]) => c[2] === "claimed");
    expect(claimedCall).toBeUndefined();
  });

  it("records multiple claimed events from the same poll in order", async () => {
    const cid = nextContractId();
    setupDb(cid, ledgerSeq - 100);
    const claim1 = makeClaimedEvent({ streamId: "1", amount: 100, ledgerClosedAt: new Date(1_700_000_000_000).toISOString() });
    const claim2 = makeClaimedEvent({ streamId: "1", amount: 200, ledgerClosedAt: new Date(1_700_001_000_000).toISOString() });
    mockGetEvents.mockResolvedValue({ events: [claim1, claim2] });

    await runOnePoll(cid);

    const claimedCalls = recordEventWithDb.mock.calls.filter((c: any[]) => c[2] === "claimed");
    expect(claimedCalls).toHaveLength(2);
    expect(claimedCalls[0][5]).toBe(claim1.value.amount);
    expect(claimedCalls[1][5]).toBe(claim2.value.amount);
  });
});

