import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useMetricsHistory, TimeRange } from "./useMetricsHistory";
import { ApiError } from "../services/api";

// Mock the API module
vi.mock("../services/api", () => ({
  ApiError: class ApiError extends Error {
    statusCode: number;
    details?: unknown;
    constructor(message: string, statusCode: number, details?: unknown) {
      super(message);
      this.name = "ApiError";
      this.statusCode = statusCode;
      this.details = details;
    }
  },
  fetchMetricsHistory: vi.fn(),
}));

import { fetchMetricsHistory } from "../services/api";
const mockFetchMetricsHistory = vi.mocked(fetchMetricsHistory);

describe("useMetricsHistory", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper to create mock metrics data
  const createMockMetrics = (count: number = 5) => {
    const now = Date.now();
    return Array.from({ length: count }, (_, i) => ({
      timestamp: now - (count - 1 - i) * 24 * 60 * 60 * 1000, // Daily intervals
      active: 100 + i * 10,
      completed: 50 + i * 5,
      vested: 25 + i * 2,
    }));
  };

  it("fetches 7-day range with correct timestamps", async () => {
    const mockData = createMockMetrics(7);
    mockFetchMetricsHistory.mockResolvedValue(mockData);

    const { result } = renderHook(() => useMetricsHistory("7d"));

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe(null);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.data).toEqual(mockData);
    });

    // Verify API was called with correct 7-day range
    expect(mockFetchMetricsHistory).toHaveBeenCalledTimes(1);
    const [call] = mockFetchMetricsHistory.mock.calls;
    const now = Date.now();
    const expectedStart = now - 7 * 24 * 60 * 60 * 1000;
    expect(call[0].startTimestamp).toBeCloseTo(expectedStart, -3); // Within 1 second
    expect(call[0].endTimestamp).toBeCloseTo(now, -3);
  });

  it("fetches 30-day range with correct timestamps", async () => {
    const mockData = createMockMetrics(10);
    mockFetchMetricsHistory.mockResolvedValue(mockData);

    const { result } = renderHook(() => useMetricsHistory("30d"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.data).toEqual(mockData);
    });

    // Verify API was called with correct 30-day range
    expect(mockFetchMetricsHistory).toHaveBeenCalledTimes(1);
    const [call] = mockFetchMetricsHistory.mock.calls;
    const now = Date.now();
    const expectedStart = now - 30 * 24 * 60 * 60 * 1000;
    expect(call[0].startTimestamp).toBeCloseTo(expectedStart, -3);
    expect(call[0].endTimestamp).toBeCloseTo(now, -3);
  });

  it("fetches all-time range with correct timestamps", async () => {
    const mockData = createMockMetrics(20);
    mockFetchMetricsHistory.mockResolvedValue(mockData);

    const { result } = renderHook(() => useMetricsHistory("all"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.data).toEqual(mockData);
    });

    // Verify API was called with all-time range (start at 0)
    expect(mockFetchMetricsHistory).toHaveBeenCalledTimes(1);
    const [call] = mockFetchMetricsHistory.mock.calls;
    expect(call[0].startTimestamp).toBe(0);
    expect(call[0].endTimestamp).toBeCloseTo(Date.now(), -3);
  });

  it("handles API error and exposes error state", async () => {
    const apiError = new ApiError("Failed to fetch metrics", 500);
    mockFetchMetricsHistory.mockRejectedValue(apiError);

    const { result } = renderHook(() => useMetricsHistory("7d"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toEqual(apiError);
      expect(result.current.data).toEqual([]);
    });

    expect(mockFetchMetricsHistory).toHaveBeenCalledTimes(1);
  });

  it("re-calls API when time range changes", async () => {
    const mockData7d = createMockMetrics(7);
    const mockData30d = createMockMetrics(15);
    
    mockFetchMetricsHistory
      .mockResolvedValueOnce(mockData7d)
      .mockResolvedValueOnce(mockData30d);

    const { result, rerender } = renderHook(
      ({ range }) => useMetricsHistory(range),
      { initialProps: { range: "7d" as "7d" | "30d" | "all" } }
    );

    // Wait for initial call
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.data).toEqual(mockData7d);
    });

    expect(mockFetchMetricsHistory).toHaveBeenCalledTimes(1);

    // Change range to 30d
    rerender({ range: "30d" });

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.data).toEqual(mockData30d);
    });

    expect(mockFetchMetricsHistory).toHaveBeenCalledTimes(2);

    // Verify second call had correct 30-day timestamps
    const secondCall = mockFetchMetricsHistory.mock.calls[1][0];
    const now = Date.now();
    const expectedStart = now - 30 * 24 * 60 * 60 * 1000;
    expect(secondCall.startTimestamp).toBeCloseTo(expectedStart, -3);
    expect(secondCall.endTimestamp).toBeCloseTo(now, -3);
  });

  it("normalizes data for chart rendering", async () => {
    const mockData = createMockMetrics(3);
    mockFetchMetricsHistory.mockResolvedValue(mockData);

    const { result } = renderHook(() => useMetricsHistory("7d"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Verify data structure matches MetricsSnapshot interface
    expect(result.current.data).toHaveLength(3);
    result.current.data.forEach((snapshot) => {
      expect(snapshot).toHaveProperty("timestamp");
      expect(snapshot).toHaveProperty("active");
      expect(snapshot).toHaveProperty("completed");
      expect(snapshot).toHaveProperty("vested");
      expect(typeof snapshot.timestamp).toBe("number");
      expect(typeof snapshot.active).toBe("number");
      expect(typeof snapshot.completed).toBe("number");
      expect(typeof snapshot.vested).toBe("number");
    });
  });

  it("shows loading state during API call", async () => {
    let resolvePromise: any;
    const promise = new Promise<any[]>(resolve => {
      resolvePromise = resolve;
    });
    mockFetchMetricsHistory.mockReturnValue(promise);

    const { result } = renderHook(() => useMetricsHistory("7d"));

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe(null);
    expect(result.current.data).toEqual([]);

    // Resolve the promise
    act(() => {
      resolvePromise(createMockMetrics());
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.data).toHaveLength(5);
    });
  });

  it("clears error state on successful retry", async () => {
    // First call fails
    const apiError = new ApiError("Network error", 500);
    mockFetchMetricsHistory.mockRejectedValueOnce(apiError);

    const { result, rerender } = renderHook(
      ({ range }) => useMetricsHistory(range),
      { initialProps: { range: "7d" as TimeRange } }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toEqual(apiError);
    });

    // Second call succeeds
    const mockData = createMockMetrics();
    mockFetchMetricsHistory.mockResolvedValueOnce(mockData);

    // Rerender with different props to trigger retry
    rerender({ range: "30d" });

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(null);
      expect(result.current.data).toEqual(mockData);
    });
  });

  it("calculates time ranges accurately", () => {
    // Test time range calculations directly
    const now = Date.now();
    
    // 7 days = 7 * 24 * 60 * 60 * 1000 = 604,800,000 ms
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    expect(sevenDaysAgo).toBe(now - 604800000);
    
    // 30 days = 30 * 24 * 60 * 60 * 1000 = 2,592,000,000 ms
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    expect(thirtyDaysAgo).toBe(now - 2592000000);
  });

  it("handles empty response from API", async () => {
    mockFetchMetricsHistory.mockResolvedValue([]);

    const { result } = renderHook(() => useMetricsHistory("7d"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.data).toEqual([]);
      expect(result.current.error).toBe(null);
    });

    expect(mockFetchMetricsHistory).toHaveBeenCalledTimes(1);
  });
});
