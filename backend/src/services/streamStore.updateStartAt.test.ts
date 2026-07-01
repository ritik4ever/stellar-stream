import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
const mockState = vi.hoisted(() => ({
  streams: new Map<string, any>(),
  events: [] as any[],
}));

const dbMocks = vi.hoisted(() => ({
  syncFtsIndex: vi.fn(),
  getDb: vi.fn(() => ({
    transaction: vi.fn((callback: () => void) => callback),
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn((id: string) => {
        const stream = mockState.streams.get(id);
        if (!stream) return undefined;
        
        // Convert to database row format
        return {
          id: stream.id,
          sender: stream.sender,
          recipient: stream.recipient,
          asset_code: stream.assetCode,
          total_amount: stream.totalAmount,
          duration_seconds: stream.durationSeconds,
          start_at: stream.startAt,
          created_at: stream.createdAt,
          canceled_at: stream.canceledAt || null,
          completed_at: stream.completedAt || null,
          refunded_amount: stream.refundedAmount || null,
          archived_at: stream.archivedAt || null,
          paused_at: stream.pausedAt || null,
          paused_duration: stream.pausedDuration || 0,
        };
      }),
    })),
  })),
  syncFtsIndex: vi.fn(),
}));

const cacheMocks = vi.hoisted(() => ({
  initCache: vi.fn(),
  getCache: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    clear: vi.fn(),
    isConnected: vi.fn(() => true),
  })),
}));

const eventHistoryMocks = vi.hoisted(() => ({
  recordEventWithDb: vi.fn((db: any, streamId: string, eventType: string, timestamp: number, actor?: string, amount?: number, metadata?: any) => {
    mockState.events.push({
      streamId,
      eventType,
      timestamp,
      actor,
      amount,
      metadata,
    });
  }),
  getStreamHistory: vi.fn((streamId: string) => {
    return mockState.events.filter(e => e.streamId === streamId);
  }),
}));

const cacheMocks = vi.hoisted(() => ({
  initCache: vi.fn(),
  getCache: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    clear: vi.fn(),
    isConnected: vi.fn(() => true),
  })),
  shutdownCache: vi.fn(),
}));

vi.mock("./cache", () => cacheMocks);
vi.mock("./db", () => dbMocks);
vi.mock("./eventHistory", () => eventHistoryMocks);
vi.mock("./cache", () => cacheMocks);

// Import after mocking
import { updateStreamStartAt, nowInSeconds } from "./streamStore";
import { getStreamHistory } from "./eventHistory";

describe("updateStreamStartAt", () => {
  const mockNow = Math.floor(Date.now() / 1000);
  const mockSender = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const mockRecipient = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

  beforeEach(() => {
    vi.clearAllMocks();
    mockState.streams.clear();
    mockState.events = [];
    
    vi.useFakeTimers();
    vi.setSystemTime(new Date(mockNow * 1000));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Successful updates", () => {
    it("should update start time of a scheduled stream and persist changes", async () => {
      const streamId = "1";
      const oldStartAt = mockNow + 3600; // 1 hour from now
      const newStartAt = mockNow + 7200; // 2 hours from now
      
      const scheduledStream = {
        id: streamId,
        sender: mockSender,
        recipient: mockRecipient,
        assetCode: "USDC",
        totalAmount: 1000,
        durationSeconds: 3600,
        startAt: oldStartAt,
        createdAt: mockNow - 1800,
      };

      mockState.streams.set(streamId, scheduledStream);

      const result = await updateStreamStartAt(streamId, newStartAt);

      // Verify the stream's startAt was updated
      expect(result.startAt).toBe(newStartAt);
      expect(result.id).toBe(streamId);

      // Verify database transaction was called
      expect(dbMocks.getDb).toHaveBeenCalled();

      // Verify start_time_updated event was recorded
      expect(eventHistoryMocks.recordEventWithDb).toHaveBeenCalledWith(
        expect.any(Object), // db handle
        streamId,
        "start_time_updated",
        mockNow,
        mockSender,
        undefined,
        { oldStartAt, newStartAt }
      );
    });

    it("should record event with correct metadata containing old and new start times", async () => {
      const streamId = "2";
      const oldStartAt = mockNow + 1800;
      const newStartAt = mockNow + 5400;
      
      const scheduledStream = {
        id: streamId,
        sender: mockSender,
        recipient: mockRecipient,
        assetCode: "USDC",
        totalAmount: 500,
        durationSeconds: 1800,
        startAt: oldStartAt,
        createdAt: mockNow - 900,
      };

      mockState.streams.set(streamId, scheduledStream);

      await updateStreamStartAt(streamId, newStartAt);

      // Verify event metadata contains both old and new start times
      const recordedEvent = mockState.events.find(e => e.eventType === "start_time_updated");
      expect(recordedEvent).toBeDefined();
      expect(recordedEvent.metadata).toEqual({
        oldStartAt,
        newStartAt,
      });
      expect(recordedEvent.actor).toBe(mockSender);
      expect(recordedEvent.timestamp).toBe(mockNow);
    });
  });

  describe("Error cases", () => {
    it("should throw 404 error when stream does not exist", async () => {
      const nonExistentStreamId = "999";
      const newStartAt = mockNow + 3600;

      await expect(
        updateStreamStartAt(nonExistentStreamId, newStartAt)
      ).rejects.toMatchObject({ message: "Stream not found.", statusCode: 404 });
    });

    it("should throw 400 error when attempting to update start time of an active stream", async () => {
      const streamId = "3";
      const activeStream = {
        id: streamId,
        sender: mockSender,
        recipient: mockRecipient,
        assetCode: "USDC",
        totalAmount: 1000,
        durationSeconds: 3600,
        startAt: mockNow - 1800, // Started 30 minutes ago (active)
        createdAt: mockNow - 3600,
      };

      mockState.streams.set(streamId, activeStream);

      await expect(
        updateStreamStartAt(streamId, mockNow + 3600)
      ).rejects.toMatchObject({ message: "Can only update start time for scheduled streams.", statusCode: 400 });
    });

    it("should throw 400 error when attempting to update start time of a completed stream", async () => {
      const streamId = "4";
      const completedStream = {
        id: streamId,
        sender: mockSender,
        recipient: mockRecipient,
        assetCode: "USDC",
        totalAmount: 1000,
        durationSeconds: 3600,
        startAt: mockNow - 7200, // Started 2 hours ago
        createdAt: mockNow - 10800,
        completedAt: mockNow - 3600, // Completed 1 hour ago
      };

      mockState.streams.set(streamId, completedStream);

      await expect(
        updateStreamStartAt(streamId, mockNow + 3600)
      ).rejects.toMatchObject({ message: "Can only update start time for scheduled streams.", statusCode: 400 });
    });

    it("should throw 400 error when attempting to update start time of a canceled stream", async () => {
      const streamId = "5";
      const canceledStream = {
        id: streamId,
        sender: mockSender,
        recipient: mockRecipient,
        assetCode: "USDC",
        totalAmount: 1000,
        durationSeconds: 3600,
        startAt: mockNow + 1800, // Was scheduled for future
        createdAt: mockNow - 1800,
        canceledAt: mockNow - 900, // Canceled 15 minutes ago
      };

      mockState.streams.set(streamId, canceledStream);

      await expect(
        updateStreamStartAt(streamId, mockNow + 3600)
      ).rejects.toMatchObject({ message: "Can only update start time for scheduled streams.", statusCode: 400 });
    });
  });

  describe("Event history verification", () => {
    it("should make start_time_updated event queryable via getStreamHistory", async () => {
      const streamId = "6";
      const oldStartAt = mockNow + 2700;
      const newStartAt = mockNow + 5400;
      
      const scheduledStream = {
        id: streamId,
        sender: mockSender,
        recipient: mockRecipient,
        assetCode: "USDC",
        totalAmount: 750,
        durationSeconds: 2700,
        startAt: oldStartAt,
        createdAt: mockNow - 1350,
      };

      mockState.streams.set(streamId, scheduledStream);

      // Perform the update
      await updateStreamStartAt(streamId, newStartAt);

      // Query the event history
      const history = getStreamHistory(streamId);
      const startTimeUpdatedEvent = history.find(e => e.eventType === "start_time_updated");

      expect(startTimeUpdatedEvent).toBeDefined();
      expect(startTimeUpdatedEvent?.streamId).toBe(streamId);
      expect(startTimeUpdatedEvent?.eventType).toBe("start_time_updated");
      expect(startTimeUpdatedEvent?.timestamp).toBe(mockNow);
      expect(startTimeUpdatedEvent?.actor).toBe(mockSender);
      expect(startTimeUpdatedEvent?.metadata).toEqual({
        oldStartAt,
        newStartAt,
      });
    });

    it("should not record event when update fails due to validation error", async () => {
      const streamId = "7";
      const activeStream = {
        id: streamId,
        sender: mockSender,
        recipient: mockRecipient,
        assetCode: "USDC",
        totalAmount: 1000,
        durationSeconds: 3600,
        startAt: mockNow - 1800, // Active stream
        createdAt: mockNow - 3600,
      };

      mockState.streams.set(streamId, activeStream);

      // Attempt to update (should fail)
      await expect(
        updateStreamStartAt(streamId, mockNow + 3600)
      ).rejects.toThrow();

      // Verify no event was recorded
      expect(eventHistoryMocks.recordEventWithDb).not.toHaveBeenCalled();
      expect(mockState.events).toHaveLength(0);
    });
  });

  describe("Edge cases", () => {
    it("should handle updating start time to the same value", async () => {
      const streamId = "8";
      const startAt = mockNow + 3600;
      
      const scheduledStream = {
        id: streamId,
        sender: mockSender,
        recipient: mockRecipient,
        assetCode: "USDC",
        totalAmount: 1000,
        durationSeconds: 3600,
        startAt: startAt,
        createdAt: mockNow - 1800,
      };

      mockState.streams.set(streamId, scheduledStream);

      const result = await updateStreamStartAt(streamId, startAt);

      // Should still work and record event
      expect(result.startAt).toBe(startAt);
      expect(eventHistoryMocks.recordEventWithDb).toHaveBeenCalledWith(
        expect.any(Object),
        streamId,
        "start_time_updated",
        mockNow,
        mockSender,
        undefined,
        { oldStartAt: startAt, newStartAt: startAt }
      );
    });

    it("should handle updating start time to a past timestamp for scheduled stream", async () => {
      const streamId = "9";
      const oldStartAt = mockNow + 3600;
      const newStartAt = mockNow - 1800; // Past time
      
      const scheduledStream = {
        id: streamId,
        sender: mockSender,
        recipient: mockRecipient,
        assetCode: "USDC",
        totalAmount: 1000,
        durationSeconds: 3600,
        startAt: oldStartAt,
        createdAt: mockNow - 3600,
      };

      mockState.streams.set(streamId, scheduledStream);

      // This should work - the function doesn't validate against past times
      // (that validation might be at the API layer or business logic layer)
      const result = await updateStreamStartAt(streamId, newStartAt);

      expect(result.startAt).toBe(newStartAt);
      expect(eventHistoryMocks.recordEventWithDb).toHaveBeenCalled();
    });
  });
});

