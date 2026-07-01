import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("./webhook", () => ({
  triggerWebhook: vi.fn(),
}));
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

    const errorSpy = loggerMocks.logger.error;

    const { initSoroban, reconcileMissingStreams } = await import("./streamStore");

    await initSoroban();
    const repaired = await reconcileMissingStreams();

    expect(repaired).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      { streamId: 2 },
      "missing stream could not be fetched from chain",
    );
    expect(eventHistoryMocks.recordEventWithDb).not.toHaveBeenCalled();

    errorSpy.mockClear();
  });
});

describe("archiveOldStreams", () => {
  const frozenTime = Math.floor(Date.now() / 1000); // Freeze time at test start
  
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    // Freeze time across all tests to avoid boundary flakiness
    vi.spyOn(Date, 'now').mockReturnValue(frozenTime * 1000);

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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
 * Creates a mock database instance for testing archiveOldStreams functionality.
 * Provides in-memory storage for streams and archived streams with SQL-like interface.
 * 
 * @returns Mock database object with prepare, transaction, and helper methods
 */
function createArchiveDbMock() {
    const streams: Array<{
      id: string;
      sender: string;
      recipient: string;
      asset_code: string;
      total_amount: number;
      duration_seconds: number;
      start_at: number;
      created_at: number;
      completed_at?: number;
      canceled_at?: number | null;
      archived_at?: number | null;
    }> = [];

    const archivedStreams: Array<{
      id: string;
      sender: string;
      recipient: string;
      asset_code: string;
      total_amount: number;
      duration_seconds: number;
      start_at: number;
      created_at: number;
      completed_at?: number | null;
      canceled_at?: number | null;
      refunded_amount?: number | null;
      archived_at: number;
    }> = [];

    return {
      prepare(sql: string) {
        if (sql.includes("SELECT * FROM streams") && 
            sql.includes("WHERE completed_at IS NOT NULL") && 
            sql.includes("AND completed_at < ?") && 
            sql.includes("AND archived_at IS NULL")) {
          return {
            all: (params: number) => {
              const threshold = params; // params is threshold directly, not an array
              return streams.filter((stream) =>
                stream.completed_at != null &&
                stream.completed_at < threshold &&
                stream.archived_at == null
              );
            },
          };
        }

        if (sql.includes("INSERT INTO stream_archive")) {
          return {
            run: (...params: (string | number | null)[]) => {
              archivedStreams.push({
                id: params[0] as string,
                sender: params[1] as string,
                recipient: params[2] as string,
                asset_code: params[3] as string,
                total_amount: params[4] as number,
                duration_seconds: params[5] as number,
                start_at: params[6] as number,
                created_at: params[7] as number,
                canceled_at: params[8] as number | null,
                completed_at: params[9] as number | null,
                refunded_amount: params[10] as number | null,
                archived_at: params[11] as number,
              });
              return { changes: 1 };
            },
          };
        }

        if (sql.includes("UPDATE streams SET archived_at")) {
          return {
            run: (...params: (number | string)[]) => {
              const archivedAt = params[0] as number;
              const streamId = params[1] as string;
              const stream = streams.find(s => s.id === streamId);
              if (stream) {
                stream.archived_at = archivedAt;
              }
              return { changes: 1 };
            },
          };
        }

        if (sql.includes("SELECT * FROM streams WHERE archived_at IS NULL")) {
          return {
            all: () => streams.filter(stream => !stream.archived_at).sort((a, b) => b.created_at - a.created_at),
          };
        }

        if (sql.includes("SELECT * FROM streams ORDER BY created_at DESC")) {
          return {
            all: () => streams.sort((a, b) => b.created_at - a.created_at),
          };
        }

        if (sql.includes("SELECT * FROM streams WHERE id = ?")) {
          return {
            get: (params: any) => streams.find(s => s.id === params[0]),
          };
        }

        return {
          all: () => [],
          run: () => ({ changes: 0 }),
          get: () => undefined,
        };
      },
      transaction<T extends (...args: any[]) => any>(callback: T): T {
        return ((...args: Parameters<T>) => {
          // Execute the callback within transaction context
          return callback(...args);
        }) as T;
      },
      // Helper methods for test setup
      _addStream(stream: any) {
        streams.push(stream);
      },
      _getArchivedStreams() {
        return archivedStreams;
      },
      _getStreams() {
        return streams;
      },
    };
  }

  /**
 * Test that completed streams older than 30 days are correctly archived.
 * Verifies archival count, archived stream data, and timestamp setting.
 */
it("archives completed streams older than 30 days", async () => {
    const now = frozenTime;
    const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60;
    
    const dbMock = createArchiveDbMock();
    dbMock._addStream({
      id: "1",
      sender: "GSENDER1",
      recipient: "GRECIPIENT1",
      asset_code: "USDC",
      total_amount: 100,
      duration_seconds: 3600,
      start_at: thirtyOneDaysAgo - 3600,
      created_at: thirtyOneDaysAgo - 3600,
      completed_at: thirtyOneDaysAgo,
      archived_at: null,
    });

    dbMocks.getDb.mockReturnValue(dbMock);

    const { archiveOldStreams } = await import("./streamStore");
    const archivedCount = await archiveOldStreams();

    expect(archivedCount).toBe(1);
    const archivedStreams = dbMock._getArchivedStreams();
    expect(archivedStreams).toHaveLength(1);
    expect(archivedStreams[0]).toMatchObject({
      id: "1",
      sender: "GSENDER1",
      recipient: "GRECIPIENT1",
      asset_code: "USDC",
      total_amount: 100,
    });
    expect(archivedStreams[0].archived_at).toBeGreaterThan(0);
    
    const streams = dbMock._getStreams();
    expect(typeof streams[0].archived_at).toBe('number');
    expect(streams[0].archived_at).toBeGreaterThan(0);
    
    });

  /**
 * Test that completed streams younger than 30 days are not archived.
 * Verifies that streams completed 29 days ago remain unarchived.
 */
it("does not archive completed streams younger than 30 days", async () => {
    const now = frozenTime;
    const twentyNineDaysAgo = now - 29 * 24 * 60 * 60;
    
    const dbMock = createArchiveDbMock();
    dbMock._addStream({
      id: "1",
      sender: "GSENDER1",
      recipient: "GRECIPIENT1",
      asset_code: "USDC",
      total_amount: 100,
      duration_seconds: 3600,
      start_at: twentyNineDaysAgo - 3600,
      created_at: twentyNineDaysAgo - 3600,
      completed_at: twentyNineDaysAgo,
      archived_at: null,
    });

    dbMocks.getDb.mockReturnValue(dbMock);

    const { archiveOldStreams } = await import("./streamStore");
    const archivedCount = await archiveOldStreams();

    expect(archivedCount).toBe(0);
    const archivedStreams = dbMock._getArchivedStreams();
    expect(archivedStreams).toHaveLength(0);
    
    const streams = dbMock._getStreams();
    expect(streams[0].archived_at).toBeNull();
  });

  /**
 * Test that active streams (without completed_at) are not archived.
 * Verifies that only completed streams are eligible for archival regardless of age.
 */
it("does not archive active streams older than 30 days", async () => {
    const now = frozenTime;
    const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60;
    
    const dbMock = createArchiveDbMock();
    dbMock._addStream({
      id: "1",
      sender: "GSENDER1",
      recipient: "GRECIPIENT1",
      asset_code: "USDC",
      total_amount: 100,
      duration_seconds: 3600,
      start_at: thirtyOneDaysAgo,
      created_at: thirtyOneDaysAgo,
      completed_at: null, // Active stream (not completed)
      archived_at: null,
    });

    dbMocks.getDb.mockReturnValue(dbMock);

    const { archiveOldStreams } = await import("./streamStore");
    const archivedCount = await archiveOldStreams();

    expect(archivedCount).toBe(0);
    const archivedStreams = dbMock._getArchivedStreams();
    expect(archivedStreams).toHaveLength(0);
    
    const streams = dbMock._getStreams();
    expect(streams[0].archived_at).toBeNull();
  });

  /**
 * Test that archived streams are excluded from default listStreams results.
 * Verifies listStreams() excludes archived streams by default but includes them when includeArchived=true.
 */
it("excludes archived streams from default listStreams results", async () => {
    const now = frozenTime;
    
    const dbMock = createArchiveDbMock();
    dbMock._addStream({
      id: "1",
      sender: "GSENDER1",
      recipient: "GRECIPIENT1",
      asset_code: "USDC",
      total_amount: 100,
      duration_seconds: 3600,
      start_at: now - 7200,
      created_at: now - 7200,
      completed_at: now - 3600,
      archived_at: null, // Not archived
    });
    dbMock._addStream({
      id: "2",
      sender: "GSENDER2",
      recipient: "GRECIPIENT2",
      asset_code: "USDC",
      total_amount: 200,
      duration_seconds: 3600,
      start_at: now - 7200,
      created_at: now - 7200,
      completed_at: now - 3600,
      archived_at: now - 1800, // Already archived
    });

    dbMocks.getDb.mockReturnValue(dbMock);

    const { listStreams } = await import("./streamStore");
    const defaultStreams = listStreams(); // Default: includeArchived = false
    const allStreams = listStreams(true); // Explicit: includeArchived = true

    expect(defaultStreams).toHaveLength(1);
    expect(defaultStreams[0].id).toBe("1");
    
    expect(allStreams).toHaveLength(2);
    expect(allStreams.map(s => s.id)).toEqual(["1", "2"]);
  });

  /**
 * Test age threshold boundary at exactly 30 days.
 * Verifies streams completed exactly 30 days ago are not archived, but 30 days + 1 second are.
 */
it("tests age threshold boundary at exactly 30 days", async () => {
    const now = frozenTime;
    const exactlyThirtyDaysAgo = now - 30 * 24 * 60 * 60;
    
    const dbMock = createArchiveDbMock();
    // Stream completed exactly 30 days ago - should not be archived (needs to be older than 30 days)
    dbMock._addStream({
      id: "1",
      sender: "GSENDER1",
      recipient: "GRECIPIENT1",
      asset_code: "USDC",
      total_amount: 100,
      duration_seconds: 3600,
      start_at: exactlyThirtyDaysAgo - 3600,
      created_at: exactlyThirtyDaysAgo - 3600,
      completed_at: exactlyThirtyDaysAgo,
      archived_at: null,
    });
    // Stream completed 30 days + 1 second ago - should be archived
    dbMock._addStream({
      id: "2",
      sender: "GSENDER2",
      recipient: "GRECIPIENT2",
      asset_code: "USDC",
      total_amount: 200,
      duration_seconds: 3600,
      start_at: exactlyThirtyDaysAgo - 3601,
      created_at: exactlyThirtyDaysAgo - 3601,
      completed_at: exactlyThirtyDaysAgo - 1,
      archived_at: null,
    });

    dbMocks.getDb.mockReturnValue(dbMock);

    const { archiveOldStreams } = await import("./streamStore");
    const archivedCount = await archiveOldStreams();

    expect(archivedCount).toBe(1);
    const archivedStreams = dbMock._getArchivedStreams();
    expect(archivedStreams).toHaveLength(1);
    expect(archivedStreams[0].id).toBe("2"); // Only the older one gets archived
    
    const streams = dbMock._getStreams();
    expect(streams.find(s => s.id === "1")?.archived_at).toBeNull();
    expect(streams.find(s => s.id === "2")?.archived_at).toBeGreaterThan(0);
  });

  /**
 * Test handling of multiple streams in a single transaction.
 * Verifies that multiple eligible streams are correctly archived together.
 */
it("handles multiple streams in a single transaction", async () => {
    const now = frozenTime;
    const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60;
    
    const dbMock = createArchiveDbMock();
    dbMock._addStream({
      id: "1",
      sender: "GSENDER1",
      recipient: "GRECIPIENT1",
      asset_code: "USDC",
      total_amount: 100,
      duration_seconds: 3600,
      start_at: thirtyOneDaysAgo - 3600,
      created_at: thirtyOneDaysAgo - 3600,
      completed_at: thirtyOneDaysAgo,
      archived_at: null,
    });
    dbMock._addStream({
      id: "2",
      sender: "GSENDER2",
      recipient: "GRECIPIENT2",
      asset_code: "USDC",
      total_amount: 200,
      duration_seconds: 3600,
      start_at: thirtyOneDaysAgo - 3600,
      created_at: thirtyOneDaysAgo - 3600,
      completed_at: thirtyOneDaysAgo,
      archived_at: null,
    });

    dbMocks.getDb.mockReturnValue(dbMock);

    const { archiveOldStreams } = await import("./streamStore");
    const archivedCount = await archiveOldStreams();

    expect(archivedCount).toBe(2);
    const archivedStreams = dbMock._getArchivedStreams();
    expect(archivedStreams).toHaveLength(2);
    expect(archivedStreams.map(s => s.id)).toEqual(["1", "2"]);
    
    const streams = dbMock._getStreams();
    streams.forEach(stream => {
      expect(stream.archived_at).toBeGreaterThan(0);
    });
  });
});

describe("metadata round-trip", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockState.nextId = 2;
    mockState.existingStreamIds = new Set<string>();
    mockState.chainStreams = new Map<number, any>();
    mockState.upsertedStreams = [];
    mockState.createdEventIds = new Set<string>();

    dbMocks.initDb.mockImplementation(() => undefined);

    process.env.CONTRACT_ID = "test-contract";
    process.env.RPC_URL = "https://rpc.test";
    delete process.env.SERVER_PRIVATE_KEY;
  });

  it("syncStreams reads metadata from on-chain stream and stores it as JSON", async () => {
    mockState.nextId = 2;
    mockState.chainStreams.set(1, {
      sender: "GSENDER",
      recipient: "GRECIPIENT",
      token: "USDC",
      total_amount: 1000,
      start_time: 0,
      end_time: 1000,
      canceled: false,
      metadata: { purpose: "salary", project: "apollo" },
    });

    let storedMetadata: string | null = null;
    const dbMock = {
      prepare(sql: string) {
        if (sql.includes("SELECT id FROM streams")) {
          return { all: () => [] };
        }
        if (sql.includes("INSERT INTO streams")) {
          return {
            run: (params: any) => {
              mockState.existingStreamIds.add(params.id);
              storedMetadata = params.metadata;
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
    dbMocks.getDb.mockReturnValue(dbMock);

    const { initSoroban, syncStreams } = await import("./streamStore");
    await initSoroban();
    await syncStreams();

    expect(storedMetadata).not.toBeNull();
    const parsed = JSON.parse(storedMetadata!);
    expect(parsed).toEqual({ purpose: "salary", project: "apollo" });
  });
});
