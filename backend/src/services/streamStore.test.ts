import { beforeEach, describe, expect, it, vi } from "vitest";

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
}));

const dbMocks = vi.hoisted(() => ({
  initDb: vi.fn(),
  getDb: vi.fn(),
}));

const eventHistoryMocks = vi.hoisted(() => ({
  recordEventWithDb: vi.fn(),
  streamHasEvent: vi.fn((streamId: string, eventType: string) => {
    return eventType === "created" && mockState.createdEventIds.has(streamId);
  }),
}));

vi.mock("./db", () => dbMocks);
vi.mock("./eventHistory", () => eventHistoryMocks);
vi.mock("./webhook", () => ({
  triggerWebhook: vi.fn(),
}));

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
      const operation = tx.operation;
      if (operation.method === "get_next_stream_id") {
        return {
          kind: "success",
          result: { retval: mockState.nextId },
        };
      }

      if (operation.method === "get_stream") {
        const streamId = Number(operation.args[0]);
        const chainStream = mockState.chainStreams.get(streamId);
        if (!chainStream) {
          return {
            kind: "error",
          };
        }

        return {
          kind: "success",
          result: { retval: chainStream },
        };
      }

      throw new Error(`Unexpected contract method: ${operation.method}`);
    }
  }

  return {
    Keypair: {
      fromSecret: vi.fn(),
    },
    rpc: {
      Server: MockServer,
      Api: {
        isSimulationSuccess: (response: any) => response.kind === "success",
      },
    },
    Contract: MockContract,
    nativeToScVal: (value: any) => value,
    scValToNative: (value: any) => value,
    Address: class MockAddress {},
    TimeoutInfinite: {},
    TransactionBuilder: MockTransactionBuilder,
    Networks: {
      TESTNET: "TESTNET",
    },
  };
});

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

describe("reconcileMissingStreams", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockState.nextId = 1;
    mockState.existingStreamIds = new Set<string>();
    mockState.chainStreams = new Map<number, any>();
    mockState.upsertedStreams = [];
    mockState.createdEventIds = new Set<string>();

    dbMocks.getDb.mockReturnValue(createDbMock());
    dbMocks.initDb.mockImplementation(() => undefined);

    process.env.CONTRACT_ID = "test-contract";
    process.env.RPC_URL = "https://rpc.test";
    delete process.env.SERVER_PRIVATE_KEY;
  });

  it("backfills only missing local streams from chain", async () => {
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
    expect(mockState.upsertedStreams[0]).toMatchObject({
      id: "2",
      sender: "GSENDER2",
      recipient: "GRECIPIENT2",
      assetCode: "USDC",
      totalAmount: 250,
      durationSeconds: 60,
    });
    expect(eventHistoryMocks.recordEventWithDb).toHaveBeenCalledTimes(1);
    expect(eventHistoryMocks.recordEventWithDb).toHaveBeenCalledWith(
      expect.anything(),
      "2",
      "created",
      100,
      "GSENDER2",
      250,
      expect.objectContaining({
        recipient: "GRECIPIENT2",
        assetCode: "USDC",
        durationSeconds: 60,
        source: "reconciliation",
      }),
    );
  });

  it("is safe to run more than once without duplicating indexed streams", async () => {
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
    const firstRunCount = await reconcileMissingStreams();
    mockState.createdEventIds = new Set(["1", "2"]);
    const secondRunCount = await reconcileMissingStreams();

    expect(firstRunCount).toBe(2);
    expect(secondRunCount).toBe(0);
    expect(mockState.upsertedStreams.map((stream) => stream.id)).toEqual([
      "1",
      "2",
    ]);
    expect(eventHistoryMocks.recordEventWithDb).toHaveBeenCalledTimes(2);
  });

  it("logs a clear failure when a missing stream cannot be fetched", async () => {
    mockState.nextId = 3;
    mockState.existingStreamIds = new Set(["1"]);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { initSoroban, reconcileMissingStreams } = await import("./streamStore");

    await initSoroban();
    const repaired = await reconcileMissingStreams();

    expect(repaired).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      "[reconciliation] missing stream 2 could not be fetched from chain",
    );
    expect(eventHistoryMocks.recordEventWithDb).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
