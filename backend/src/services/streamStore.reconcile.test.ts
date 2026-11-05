import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

type StoredStream = {
  id: string;
  sender: string;
  recipient: string;
  assetCode: string;
  totalAmount: number;
  durationSeconds: number;
  startAt: number;
  createdAt: number;
  canceledAt?: number | null;
  completedAt?: number | null;
};

const mockState = vi.hoisted(() => ({
  nextId: 1,
  existingStreamIds: new Set<string>(),
  chainStreams: new Map<number, any>(),
  upsertedStreams: [] as StoredStream[],
  createdEventIds: new Set<string>(),
  simulateTimeout: false,
  streamFailures: new Map<number, Error>(),
  streamTransientFailures: new Map<number, number>(),
  eventInsertionFailure: false,
  readBackCreatedAt: undefined as number | undefined,
}));

const dbMocks = vi.hoisted(() => ({
  initDb: vi.fn(),
  getDb: vi.fn(),
  syncFtsIndex: vi.fn(),
}));

const eventHistoryMocks = vi.hoisted(() => ({
  recordEventWithDb: vi.fn((_db: any, streamId: string) => {
    if (mockState.eventInsertionFailure) {
      throw new Error("simulated event insertion failure");
    }
    mockState.createdEventIds.add(streamId);
  }),
  streamHasEvent: vi.fn((streamId: string, eventType: string) => {
    return eventType === "created" && mockState.createdEventIds.has(streamId);
  }),
}));

const loggerMocks = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("./db", () => dbMocks);
vi.mock("./eventHistory", () => eventHistoryMocks);
vi.mock("./webhook", () => ({ triggerWebhook: vi.fn() }));
vi.mock("../logger", () => loggerMocks);

vi.mock("@stellar/stellar-sdk", () => {
  class MockContract {
    contractId: string;
    constructor(contractId: string) {
      this.contractId = contractId;
    }
    call(method: string, ...args: any[]) {
      return { method, args };
    }
  }

  class MockTransactionBuilder {
    private operation: any;
    constructor(_sourceAccount: any, _options: any) {}
    addOperation(operation: any) {
      this.operation = operation;
      return this;
    }
    setTimeout(_timeout: number) {
      return this;
    }
    build() {
      return { operation: this.operation };
    }
  }

  class MockServer {
    constructor(_rpcUrl: string) {}

    async getAccount(_pubKey: string) {
      return { accountId: "mock-account" };
    }

    async simulateTransaction(tx: any) {
      if (mockState.simulateTimeout) {
        throw new Error("timeout: RPC server did not respond");
      }

      const operation = tx.operation;
      if (operation.method === "get_next_stream_id") {
        return { kind: "success", result: { retval: mockState.nextId } };
      }

      if (operation.method === "get_stream") {
        const streamId = Number(operation.args[0]);
        const transientCount = mockState.streamTransientFailures.get(streamId) ?? 0;
        if (transientCount > 0) {
          mockState.streamTransientFailures.set(streamId, transientCount - 1);
          throw new Error("timeout: transient RPC glitch");
        }
        const failError = mockState.streamFailures.get(streamId);
        if (failError) {
          throw failError;
        }
        const chainStream = mockState.chainStreams.get(streamId);
        if (!chainStream) {
          return { kind: "error" };
        }
        return { kind: "success", result: { retval: chainStream } };
      }

      throw new Error(`Unexpected contract method: ${operation.method}`);
    }
  }

  return {
    Keypair: { fromSecret: vi.fn() },
    rpc: {
      Server: MockServer,
      Api: { isSimulationSuccess: (response: any) => response.kind === "success" },
    },
    Contract: MockContract,
    nativeToScVal: (value: any) => value,
    scValToNative: (value: any) => value,
    Address: class MockAddress {},
    TimeoutInfinite: {},
    TransactionBuilder: MockTransactionBuilder,
    Networks: { TESTNET: "TESTNET" },
  };
});

// ---------------------------------------------------------------------------
// DB mock factory
// ---------------------------------------------------------------------------

function createDbMock() {
  return {
    prepare(sql: string) {
      if (sql.includes("SELECT * FROM streams WHERE id = ?")) {
        return {
          get: (id: string) => {
            const stream = mockState.upsertedStreams.find((item) => item.id === id);
            if (!stream) return undefined;
            return {
              id: stream.id,
              sender: stream.sender,
              recipient: stream.recipient,
              asset_code: stream.assetCode,
              total_amount: stream.totalAmount,
              duration_seconds: stream.durationSeconds,
              start_at: stream.startAt,
              created_at: mockState.readBackCreatedAt ?? stream.createdAt,
              canceled_at: stream.canceledAt ?? null,
              completed_at: stream.completedAt ?? null,
              refunded_amount: null,
              archived_at: null,
              paused_at: null,
              paused_duration: 0,
              cliff_seconds: 0,
              metadata: null,
            };
          },
        };
      }

      if (sql.includes("SELECT id FROM streams")) {
        return {
          all: () =>
            Array.from(mockState.existingStreamIds).map((id) => ({ id })),
        };
      }

      if (sql.includes("INSERT INTO streams")) {
        return {
          run: (params: any) => {
            mockState.existingStreamIds.add(params.id);
            // Replace existing entry if already upserted to mimic ON CONFLICT DO UPDATE
            const existingIdx = mockState.upsertedStreams.findIndex((s) => s.id === params.id);
            const record = {
              id: params.id,
              sender: params.sender,
              recipient: params.recipient,
              assetCode: params.assetCode,
              totalAmount: params.totalAmount,
              durationSeconds: params.durationSeconds,
              startAt: params.startAt,
              createdAt: params.createdAt,
              canceledAt: params.canceledAt,
              completedAt: params.completedAt,
            };
            if (existingIdx >= 0) {
              mockState.upsertedStreams[existingIdx] = record;
            } else {
              mockState.upsertedStreams.push(record);
            }
            return { changes: 1 };
          },
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    },
    transaction<T extends (...args: any[]) => any>(callback: T): T {
      return ((...args: Parameters<T>) => {
        const streamSnapshot = [...mockState.upsertedStreams];
        const idSnapshot = new Set(mockState.existingStreamIds);
        const eventSnapshot = new Set(mockState.createdEventIds);
        try {
          return callback(...args);
        } catch (err) {
          mockState.upsertedStreams = streamSnapshot;
          mockState.existingStreamIds = idSnapshot;
          mockState.createdEventIds = eventSnapshot;
          throw err;
        }
      }) as T;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reconcileMissingStreams – sync correctness", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockState.nextId = 1;
    mockState.existingStreamIds = new Set<string>();
    mockState.chainStreams = new Map<number, any>();
    mockState.upsertedStreams = [];
    mockState.createdEventIds = new Set<string>();
    mockState.simulateTimeout = false;
    mockState.streamFailures = new Map<number, Error>();
    mockState.streamTransientFailures = new Map<number, number>();
    mockState.eventInsertionFailure = false;
    mockState.readBackCreatedAt = undefined;

    dbMocks.getDb.mockReturnValue(createDbMock());
    dbMocks.initDb.mockImplementation(() => undefined);

    process.env.CONTRACT_ID = "test-contract";
    process.env.RPC_URL = "https://rpc.test";
    delete process.env.SERVER_PRIVATE_KEY;
  });

  it("inserts on-chain streams that are missing from local SQLite with correct field mapping", async () => {
    mockState.nextId = 3;
    mockState.chainStreams.set(1, {
      sender: "GSENDER1",
      recipient: "GRECIPIENT1",
      token: "USDC",
      total_amount: 500,
      start_time: 200,
      end_time: 800,
      canceled: false,
    });
    mockState.chainStreams.set(2, {
      sender: "GSENDER2",
      recipient: "GRECIPIENT2",
      token: "XLM",
      total_amount: 1000,
      start_time: 300,
      end_time: 900,
      canceled: false,
    });

    const { initSoroban, reconcileMissingStreams } = await import("./streamStore");
    await initSoroban();
    const repaired = await reconcileMissingStreams();

    expect(repaired).toBe(2);
    expect(mockState.upsertedStreams).toHaveLength(2);

    expect(mockState.upsertedStreams[0]).toMatchObject({
      id: "1",
      sender: "GSENDER1",
      recipient: "GRECIPIENT1",
      assetCode: "USDC",
      totalAmount: 500,
      durationSeconds: 600, // 800 - 200
      startAt: 200,
    });

    expect(mockState.upsertedStreams[1]).toMatchObject({
      id: "2",
      sender: "GSENDER2",
      recipient: "GRECIPIENT2",
      assetCode: "XLM",
      totalAmount: 1000,
      durationSeconds: 600, // 900 - 300
      startAt: 300,
    });

    // Created events must be recorded for both
    expect(eventHistoryMocks.recordEventWithDb).toHaveBeenCalledTimes(2);
    expect(eventHistoryMocks.recordEventWithDb).toHaveBeenCalledWith(
      expect.anything(),
      "1",
      "created",
      200,
      "GSENDER1",
      500,
      expect.objectContaining({ source: "reconciliation" }),
    );
    expect(eventHistoryMocks.recordEventWithDb).toHaveBeenCalledWith(
      expect.anything(),
      "2",
      "created",
      300,
      "GSENDER2",
      1000,
      expect.objectContaining({ source: "reconciliation" }),
    );
  });

  it("does not duplicate rows for streams already present in local DB", async () => {
    mockState.nextId = 3;
    // Both streams already exist locally
    mockState.existingStreamIds = new Set(["1", "2"]);
    mockState.createdEventIds = new Set(["1", "2"]);
    mockState.chainStreams.set(1, {
      sender: "GSENDER1",
      recipient: "GRECIPIENT1",
      token: "USDC",
      total_amount: 100,
      start_time: 10,
      end_time: 20,
      canceled: false,
    });
    mockState.chainStreams.set(2, {
      sender: "GSENDER2",
      recipient: "GRECIPIENT2",
      token: "USDC",
      total_amount: 200,
      start_time: 30,
      end_time: 50,
      canceled: false,
    });

    const { initSoroban, reconcileMissingStreams } = await import("./streamStore");
    await initSoroban();
    const repaired = await reconcileMissingStreams();

    // Nothing to repair — no upserts, no events
    expect(repaired).toBe(0);
    expect(mockState.upsertedStreams).toHaveLength(0);
    expect(eventHistoryMocks.recordEventWithDb).not.toHaveBeenCalled();
  });

  it("only backfills the missing stream when some are present and some are not", async () => {
    mockState.nextId = 4;
    mockState.existingStreamIds = new Set(["1", "3"]);
    mockState.chainStreams.set(2, {
      sender: "GSENDER2",
      recipient: "GRECIPIENT2",
      token: "USDC",
      total_amount: 250,
      start_time: 100,
      end_time: 160,
      canceled: false,
    });

    const { initSoroban, reconcileMissingStreams } = await import("./streamStore");
    await initSoroban();
    const repaired = await reconcileMissingStreams();

    expect(repaired).toBe(1);
    expect(mockState.upsertedStreams).toHaveLength(1);
    expect(mockState.upsertedStreams[0].id).toBe("2");

    // Row count: only 1 new row inserted
    expect(eventHistoryMocks.recordEventWithDb).toHaveBeenCalledTimes(1);
  });

  it("does not crash when RPC times out — logs error and returns 0", async () => {
    mockState.nextId = 3;
    mockState.existingStreamIds = new Set(["1"]);
    // Trigger timeout on all RPC calls
    mockState.simulateTimeout = true;

    const errorSpy = loggerMocks.logger.error;

    const { initSoroban, reconcileMissingStreams } = await import("./streamStore");
    await initSoroban();
    const repaired = await reconcileMissingStreams();

    // Reconciliation must not throw — returns 0 and logs the error
    expect(repaired).toBe(0);
    expect(errorSpy).toHaveBeenCalled();
    expect(mockState.upsertedStreams).toHaveLength(0);

    errorSpy.mockClear();
  });

  it("is idempotent — running twice does not duplicate rows or events", async () => {
    mockState.nextId = 3;
    mockState.chainStreams.set(1, {
      sender: "GSENDER1",
      recipient: "GRECIPIENT1",
      token: "USDC",
      total_amount: 100,
      start_time: 10,
      end_time: 20,
      canceled: false,
    });
    mockState.chainStreams.set(2, {
      sender: "GSENDER2",
      recipient: "GRECIPIENT2",
      token: "USDC",
      total_amount: 200,
      start_time: 30,
      end_time: 50,
      canceled: false,
    });

    const { initSoroban, reconcileMissingStreams } = await import("./streamStore");
    await initSoroban();

    const firstRun = await reconcileMissingStreams();
    // Simulate events now recorded after first run
    mockState.createdEventIds = new Set(["1", "2"]);
    const secondRun = await reconcileMissingStreams();

    expect(firstRun).toBe(2);
    expect(secondRun).toBe(0);
    // Upsert is called twice on second run (upsert is idempotent by design via ON CONFLICT)
    // but recordEventWithDb must only be called for the first run
    expect(eventHistoryMocks.recordEventWithDb).toHaveBeenCalledTimes(2);
  });

  it("handles RPC outage mid-reconciliation: breaks early, preserves prior commits without duplicate state on recovery", async () => {
    mockState.nextId = 4; // streams 1, 2, 3 missing
    mockState.chainStreams.set(1, {
      sender: "GSENDER1",
      recipient: "GRECIPIENT1",
      token: "USDC",
      total_amount: 100,
      start_time: 10,
      end_time: 20,
      canceled: false,
    });
    // Stream 2 triggers persistent RPC outage
    mockState.streamFailures.set(2, new Error("timeout: RPC server outage"));
    mockState.chainStreams.set(3, {
      sender: "GSENDER3",
      recipient: "GRECIPIENT3",
      token: "USDC",
      total_amount: 300,
      start_time: 50,
      end_time: 80,
      canceled: false,
    });

    const { initSoroban, reconcileMissingStreams } = await import("./streamStore");
    await initSoroban();

    // First cycle: stream 1 succeeds, stream 2 experiences RPC outage, loop breaks early
    const firstRepaired = await reconcileMissingStreams();
    expect(firstRepaired).toBe(1);
    expect(mockState.upsertedStreams).toHaveLength(1);
    expect(mockState.upsertedStreams[0].id).toBe("1");
    expect(mockState.existingStreamIds.has("1")).toBe(true);
    expect(mockState.existingStreamIds.has("2")).toBe(false);
    expect(mockState.existingStreamIds.has("3")).toBe(false);

    // RPC recovers
    mockState.streamFailures.clear();
    mockState.chainStreams.set(2, {
      sender: "GSENDER2",
      recipient: "GRECIPIENT2",
      token: "USDC",
      total_amount: 200,
      start_time: 20,
      end_time: 40,
      canceled: false,
    });

    // Second cycle: resumes safely, repairs remaining streams 2 and 3 without duplicating stream 1 or its events
    const secondRepaired = await reconcileMissingStreams();
    expect(secondRepaired).toBe(2);
    expect(mockState.existingStreamIds.size).toBe(3);
    // Exactly 3 unique streams and 3 created events recorded
    expect(mockState.createdEventIds.size).toBe(3);
    expect(eventHistoryMocks.recordEventWithDb).toHaveBeenCalledTimes(3);
  });

  it("rolls back stream record when event insertion fails inside the atomic transaction", async () => {
    mockState.nextId = 2;
    mockState.chainStreams.set(1, {
      sender: "GSENDER1",
      recipient: "GRECIPIENT1",
      token: "USDC",
      total_amount: 100,
      start_time: 10,
      end_time: 20,
      canceled: false,
    });
    mockState.eventInsertionFailure = true;

    const { initSoroban, reconcileMissingStreams } = await import("./streamStore");
    await initSoroban();

    const repaired = await reconcileMissingStreams();
    expect(repaired).toBe(0);
    // Rolled back cleanly: no stream inserted in SQLite
    expect(mockState.existingStreamIds.has("1")).toBe(false);
    expect(mockState.upsertedStreams).toHaveLength(0);
  });

  it("reconciles local state lagging a confirmed on-chain event without duplicating events or rows", async () => {
    mockState.nextId = 2;
    // Local state lags: stream 1 exists locally active
    mockState.existingStreamIds.add("1");
    mockState.createdEventIds.add("1");
    mockState.upsertedStreams.push({
      id: "1",
      sender: "GSENDER1",
      recipient: "GRECIPIENT1",
      assetCode: "USDC",
      totalAmount: 100,
      durationSeconds: 10,
      startAt: 10,
      createdAt: 10,
      canceledAt: null,
      completedAt: null,
    });

    // Confirmed on-chain event: stream 1 was canceled on-chain
    mockState.chainStreams.set(1, {
      sender: "GSENDER1",
      recipient: "GRECIPIENT1",
      token: "USDC",
      total_amount: 100,
      start_time: 10,
      end_time: 20,
      canceled: true,
    });

    const { initSoroban, reconcileStream } = await import("./streamStore");
    await initSoroban();

    const updated = await reconcileStream("1");
    expect(updated.canceledAt).toBeDefined();

    // Verify stored state is updated without duplicating rows
    const stored = mockState.upsertedStreams.filter((s) => s.id === "1");
    expect(stored).toHaveLength(1);
    expect(stored[0].canceledAt).toBeDefined();
    // Created event must not be duplicated
    expect(eventHistoryMocks.recordEventWithDb).not.toHaveBeenCalled();
  });

  it("returns the committed local record rather than the fetched RPC object", async () => {
    mockState.chainStreams.set(1, {
      sender: "GSENDER1",
      recipient: "GRECIPIENT1",
      token: "USDC",
      total_amount: 100,
      start_time: 10,
      end_time: 20,
      canceled: false,
    });
    mockState.readBackCreatedAt = 99;

    const { initSoroban, reconcileStream } = await import("./streamStore");
    await initSoroban();

    const updated = await reconcileStream("1");

    expect(updated.createdAt).toBe(99);
    expect(mockState.upsertedStreams[0].createdAt).toBe(10);
  });

  it("does not report a successful reconciliation when its transaction fails", async () => {
    mockState.chainStreams.set(1, {
      sender: "GSENDER1",
      recipient: "GRECIPIENT1",
      token: "USDC",
      total_amount: 100,
      start_time: 10,
      end_time: 20,
      canceled: false,
    });
    mockState.eventInsertionFailure = true;

    const { initSoroban, reconcileStream } = await import("./streamStore");
    await initSoroban();

    await expect(reconcileStream("1")).rejects.toThrow(
      "simulated event insertion failure",
    );
    expect(mockState.existingStreamIds.has("1")).toBe(false);
    expect(mockState.upsertedStreams).toHaveLength(0);
  });
});
