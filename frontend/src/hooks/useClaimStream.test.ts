import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useClaimStream } from "./useClaimStream";
import { useClaimBatch } from "./useClaimBatch";
import {
  claimStream,
  getClaimableBatch,
  SorobanClaimError,
  ClaimResult,
} from "../services/soroban";
import type { StreamEvent } from "../services/api";

// Mock the soroban module
vi.mock("../services/soroban", () => ({
  claimStream: vi.fn(),
  getClaimableBatch: vi.fn(),
  SorobanClaimError: class SorobanClaimError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "SorobanClaimError";
      this.code = code;
    }
  },
}));

const mockClaimStream = vi.mocked(claimStream);
const mockGetClaimableBatch = vi.mocked(getClaimableBatch);

describe("useClaimStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper to create mock claim result
  const createMockClaimResult = (amount: number = 100): ClaimResult => ({
    claimedAmount: amount,
    assetCode: "USDC",
    txHash: "0x1234567890abcdef",
  });

  // Helper to create mock history
  const createMockHistory = (): StreamEvent[] => [
    {
      id: 1,
      streamId: "123",
      eventType: "claimed",
      timestamp: Date.now(),
      actor: "GTEST123456789",
      amount: 100,
    },
  ];

  it("sets loading state correctly during successful claim", async () => {
    const mockResult = createMockClaimResult();
    const mockHistory = createMockHistory();
    
    mockClaimStream.mockResolvedValue({
      result: mockResult,
      history: mockHistory,
    });

    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    const { result } = renderHook(() => 
      useClaimStream(onSuccess, onFailure)
    );

    // Initial state
    expect(result.current.claimState.status).toBe("idle");
    expect(result.current.isPending).toBe(false);

    // Start claim - wrapped in act since it triggers state updates
    act(() => {
      result.current.claim({
        streamId: "123",
        recipientAddress: "GTEST123456789",
        amount: 100,
      });
    });

    // Loading state should be true immediately (synchronous update)
    expect(result.current.claimState.status).toBe("pending");
    expect(result.current.isPending).toBe(true);
    expect(result.current.claimState.streamId).toBe("123");
    expect(result.current.claimState.error).toBe(null);

    // Wait for completion (async resolution)
    await waitFor(() => {
      expect(result.current.claimState.status).toBe("confirmed");
      expect(result.current.isPending).toBe(false);
    });

    // Verify success callback was called
    expect(onSuccess).toHaveBeenCalledWith("123", mockResult, mockHistory);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("transitions loading state from false → true → false", async () => {
    const mockResult = createMockClaimResult();
    const mockHistory = createMockHistory();
    
    mockClaimStream.mockResolvedValue({
      result: mockResult,
      history: mockHistory,
    });

    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    const { result } = renderHook(() => 
      useClaimStream(onSuccess, onFailure)
    );

    // State 1: false (idle)
    expect(result.current.isPending).toBe(false);
    expect(result.current.claimState.status).toBe("idle");

    // Start claim - State 2: true (pending)
    act(() => {
      result.current.claim({
        streamId: "123",
        recipientAddress: "GTEST123456789",
        amount: 100,
      });
    });

    expect(result.current.isPending).toBe(true);
    expect(result.current.claimState.status).toBe("pending");

    // Wait for completion - State 3: false (confirmed)
    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
      expect(result.current.claimState.status).toBe("confirmed");
    });
  });

  it("exposes API error via error field", async () => {
    const apiError = new SorobanClaimError("Insufficient balance", "INSUFFICIENT_BALANCE");
    mockClaimStream.mockRejectedValue(apiError);

    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    const { result } = renderHook(() => 
      useClaimStream(onSuccess, onFailure)
    );

    act(() => {
      result.current.claim({
        streamId: "123",
        recipientAddress: "GTEST123456789",
        amount: 100,
      });
    });

    // Wait for error
    await waitFor(() => {
      expect(result.current.claimState.status).toBe("failed");
      expect(result.current.isPending).toBe(false);
      expect(result.current.claimState.error).toBe("Insufficient balance");
      expect(result.current.claimState.streamId).toBe("123");
    });

    // Verify error callback was called
    expect(onFailure).toHaveBeenCalledWith("123", "Insufficient balance");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("handles generic error and converts to message", async () => {
    const genericError = new Error("Network error");
    mockClaimStream.mockRejectedValue(genericError);

    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    const { result } = renderHook(() => 
      useClaimStream(onSuccess, onFailure)
    );

    act(() => {
      result.current.claim({
        streamId: "123",
        recipientAddress: "GTEST123456789",
        amount: 100,
      });
    });

    await waitFor(() => {
      expect(result.current.claimState.status).toBe("failed");
      expect(result.current.claimState.error).toBe("Network error");
    });

    expect(onFailure).toHaveBeenCalledWith("123", "Network error");
  });

  it("handles non-Error objects gracefully", async () => {
    mockClaimStream.mockRejectedValue("String error");

    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    const { result } = renderHook(() => 
      useClaimStream(onSuccess, onFailure)
    );

    act(() => {
      result.current.claim({
        streamId: "123",
        recipientAddress: "GTEST123456789",
        amount: 100,
      });
    });

    await waitFor(() => {
      expect(result.current.claimState.status).toBe("failed");
      expect(result.current.claimState.error).toBe("Claim failed. Please try again.");
    });

    expect(onFailure).toHaveBeenCalledWith("123", "Claim failed. Please try again.");
  });

  it("prevents API call when amount is 0", async () => {
    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    const { result } = renderHook(() => 
      useClaimStream(onSuccess, onFailure)
    );

    // Try to claim with amount 0
    act(() => {
      result.current.claim({
        streamId: "123",
        recipientAddress: "GTEST123456789",
        amount: 0,
      });
    });

    // Should not call API and remain in idle state
    expect(mockClaimStream).not.toHaveBeenCalled();
    expect(result.current.claimState.status).toBe("idle");
    expect(result.current.isPending).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("prevents concurrent claims", async () => {
    const mockResult = createMockClaimResult();
    const mockHistory = createMockHistory();
    
    let resolveClaimPromise: any;
    const claimPromise = new Promise((resolve) => {
      resolveClaimPromise = resolve;
    });
    mockClaimStream.mockReturnValue(claimPromise as any);

    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    const { result } = renderHook(() => 
      useClaimStream(onSuccess, onFailure)
    );

    // Start first claim
    act(() => {
      result.current.claim({
        streamId: "123",
        recipientAddress: "GTEST123456789",
        amount: 100,
      });
    });

    expect(result.current.isPending).toBe(true);

    // Try second claim while first is pending
    act(() => {
      result.current.claim({
        streamId: "456",
        recipientAddress: "GTEST123456789",
        amount: 200,
      });
    });

    // Should only have one API call
    expect(mockClaimStream).toHaveBeenCalledTimes(1);
    expect(mockClaimStream).toHaveBeenCalledWith("123", "GTEST123456789", 100);

    // Resolve first claim
    act(() => {
      resolveClaimPromise({ result: mockResult, history: mockHistory });
    });

    await waitFor(() => {
      expect(result.current.claimState.status).toBe("confirmed");
    });

    expect(mockClaimStream).toHaveBeenCalledTimes(1);
  });

  it("resets to idle after successful claim delay", async () => {
    vi.useFakeTimers();
    try {
      const mockResult = createMockClaimResult();
      const mockHistory = createMockHistory();
      
      mockClaimStream.mockResolvedValue({
        result: mockResult,
        history: mockHistory,
      });

      const onSuccess = vi.fn();
      const onFailure = vi.fn();

      const { result } = renderHook(() => 
        useClaimStream(onSuccess, onFailure)
      );

      act(() => {
        result.current.claim({
          streamId: "123",
          recipientAddress: "GTEST123456789",
          amount: 100,
        });
      });

      // Wait for confirmed state. Flush microtasks only.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.claimState.status).toBe("confirmed");

      // Advance time by 2 seconds for reset
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(result.current.claimState.status).toBe("idle");
      expect(result.current.claimState.streamId).toBe(null);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns correct claimed amount from API response", async () => {
    const mockResult = createMockClaimResult(250.5);
    const mockHistory = createMockHistory();
    
    mockClaimStream.mockResolvedValue({
      result: mockResult,
      history: mockHistory,
    });

    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    const { result } = renderHook(() => 
      useClaimStream(onSuccess, onFailure)
    );

    act(() => {
      result.current.claim({
        streamId: "123",
        recipientAddress: "GTEST123456789",
        amount: 100,
      });
    });

    await waitFor(() => {
      expect(result.current.claimState.status).toBe("confirmed");
    });

    // Verify the returned amount matches API response
    expect(onSuccess).toHaveBeenCalledWith(
      "123", 
      expect.objectContaining({ claimedAmount: 250.5 }), 
      mockHistory
    );
  });

  describe("useClaimBatch", () => {
    it("fetches claimable batch and claims streams sequentially", async () => {
      mockGetClaimableBatch.mockResolvedValue({
        amounts: { "1": 100, "2": 50 },
        at: 1716812160,
      });

      const mockResult = createMockClaimResult(100);
      const mockHistory = createMockHistory();
      mockClaimStream
        .mockResolvedValueOnce({ result: mockResult, history: mockHistory })
        .mockResolvedValueOnce({
          result: { ...mockResult, claimedAmount: 50 },
          history: mockHistory,
        });

      const onSuccess = vi.fn();

      const { result } = renderHook(() => useClaimBatch(onSuccess));

      let claimable: { streamId: string; amount: number; assetCode: string }[] = [];
      await act(async () => {
        claimable = await result.current.fetchClaimable([
          { streamId: "1", amount: 0, assetCode: "XLM" },
          { streamId: "2", amount: 0, assetCode: "XLM" },
        ]);
      });

      expect(mockGetClaimableBatch).toHaveBeenCalledWith(["1", "2"]);
      expect(claimable).toHaveLength(2);
      expect(result.current.state.totalClaimable).toBe(150);
      expect(result.current.state.phase).toBe("ready");

      await act(async () => {
        await result.current.executeBatch(claimable, "GTEST123456789");
      });

      expect(mockClaimStream).toHaveBeenCalledTimes(2);
      expect(mockClaimStream).toHaveBeenNthCalledWith(1, "1", "GTEST123456789", 100, "XLM");
      expect(mockClaimStream).toHaveBeenNthCalledWith(2, "2", "GTEST123456789", 50, "XLM");
      expect(onSuccess).toHaveBeenCalledTimes(2);
      expect(result.current.state.phase).toBe("complete");
      expect(result.current.state.successCount).toBe(2);
    });

    it("records failures in batch summary state", async () => {
      mockGetClaimableBatch.mockResolvedValue({
        amounts: { "1": 100 },
        at: 1716812160,
      });

      mockClaimStream.mockRejectedValue(new Error("Network error"));

      const onSuccess = vi.fn();
      const { result } = renderHook(() => useClaimBatch(onSuccess));

      let claimable: { streamId: string; amount: number; assetCode: string }[] = [];
      await act(async () => {
        claimable = await result.current.fetchClaimable([
          { streamId: "1", amount: 0, assetCode: "XLM" },
        ]);
      });

      await act(async () => {
        await result.current.executeBatch(claimable, "GTEST123456789");
      });

      expect(result.current.state.failures).toEqual([
        { streamId: "1", message: "Network error" },
      ]);
      expect(result.current.state.successCount).toBe(0);
    });
  });

  it("clears error state on successful retry", async () => {
    // First call fails
    const apiError = new SorobanClaimError("Insufficient balance", "INSUFFICIENT_BALANCE");
    mockClaimStream.mockRejectedValueOnce(apiError);

    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    const { result } = renderHook(() => 
      useClaimStream(onSuccess, onFailure)
    );

    act(() => {
      result.current.claim({
        streamId: "123",
        recipientAddress: "GTEST123456789",
        amount: 100,
      });
    });

    await waitFor(() => {
      expect(result.current.claimState.status).toBe("failed");
      expect(result.current.claimState.error).toBe("Insufficient balance");
    });

    // Second call succeeds
    const mockResult = createMockClaimResult();
    const mockHistory = createMockHistory();
    mockClaimStream.mockResolvedValueOnce({
      result: mockResult,
      history: mockHistory,
    });

    // Retry claim
    act(() => {
      result.current.claim({
        streamId: "123",
        recipientAddress: "GTEST123456789",
        amount: 100,
      });
    });

    await waitFor(() => {
      expect(result.current.claimState.status).toBe("confirmed");
      expect(result.current.claimState.error).toBe(null);
    });
  });
});
