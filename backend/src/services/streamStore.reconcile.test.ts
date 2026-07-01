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
}));

const dbMocks = vi.hoisted(() => ({
  initDb: vi.fn(),
  getDb: vi.fn(),
  syncFtsIndex: vi.fn(),
}));

const eventHistoryMocks = vi.hoisted(() => ({
  recordEventWithDb: vi.fn(),
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
            mockState.upsertedStreams.push({
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
            });
            return { changes: 1 };
          },
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    },
    transaction<T extends (...args: any[]) => any>(callback: T): T {
      return ((...args: Parameters<T>) => callback(...args)) as T;
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
});
