import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { useStreamFilter } from "./useStreamFilter";
import { Stream } from "../types/stream";

const mockStreams: Stream[] = [
  {
    id: "stream_1",
    sender: "G_SENDER_1",
    recipient: "G_RECIPIENT_1",
    assetCode: "USDC",
    totalAmount: 100,
    durationSeconds: 3600,
    startAt: 1000,
    createdAt: 900,
    progress: {
      status: "active",
      ratePerSecond: 0.1,
      elapsedSeconds: 500,
      vestedAmount: 50,
      remainingAmount: 50,
      percentComplete: 50,
    },
  },
  {
    id: "stream_2",
    sender: "G_SENDER_2",
    recipient: "G_RECIPIENT_2",
    assetCode: "XLM",
    totalAmount: 200,
    durationSeconds: 7200,
    startAt: 2000,
    createdAt: 1900,
    progress: {
      status: "completed",
      ratePerSecond: 0.2,
      elapsedSeconds: 7200,
      vestedAmount: 200,
      remainingAmount: 0,
      percentComplete: 100,
    },
  },
  {
    id: "stream_3",
    sender: "G_SENDER_1",
    recipient: "G_RECIPIENT_2",
    assetCode: "USDC",
    totalAmount: 300,
    durationSeconds: 3600,
    startAt: 3000,
    createdAt: 2900,
    progress: {
      status: "scheduled",
      ratePerSecond: 0.3,
      elapsedSeconds: 0,
      vestedAmount: 0,
      remainingAmount: 300,
      percentComplete: 0,
    },
  },
];

describe("useStreamFilter", () => {
  beforeEach(() => {
    // Clear URL search params before each test
    window.history.replaceState(null, "", "/");
  });

  it("returns all streams by default", () => {
    const { result } = renderHook(() => useStreamFilter(mockStreams));
    expect(result.current.filteredStreams).toHaveLength(3);
    expect(result.current.filteredStreams).toEqual(mockStreams);
  });

  it("filters by status", () => {
    const { result } = renderHook(() => useStreamFilter(mockStreams));
    
    act(() => {
      result.current.setFilter("status", "active");
    });
    
    expect(result.current.filteredStreams).toHaveLength(1);
    expect(result.current.filteredStreams[0].id).toBe("stream_1");
  });

  it("keeps the active status filter matched after a scheduled stream becomes active", () => {
    const { result, rerender } = renderHook(
      ({ streams }) => useStreamFilter(streams),
      { initialProps: { streams: mockStreams } },
    );

    act(() => {
      result.current.setFilter("status", "active");
    });
    expect(result.current.filteredStreams.map((stream) => stream.id)).toEqual([
      "stream_1",
    ]);

    const transitionedStreams = mockStreams.map((stream) =>
      stream.id === "stream_3"
        ? { ...stream, progress: { ...stream.progress, status: "active" as const } }
        : stream,
    );
    rerender({ streams: transitionedStreams });

    expect(result.current.filters.status).toBe("active");
    expect(result.current.filteredStreams.map((stream) => stream.id)).toEqual([
      "stream_1",
      "stream_3",
    ]);
  });

  it("filters by sender address (case-insensitive)", () => {
    const { result } = renderHook(() => useStreamFilter(mockStreams));
    
    act(() => {
      result.current.setFilter("sender", "g_sender_1");
    });
    
    expect(result.current.filteredStreams).toHaveLength(2);
    expect(result.current.filteredStreams.map(s => s.id)).toEqual(["stream_1", "stream_3"]);
  });

  it("filters by recipient address", () => {
    const { result } = renderHook(() => useStreamFilter(mockStreams));
    
    act(() => {
      result.current.setFilter("recipient", "G_RECIPIENT_2");
    });
    
    expect(result.current.filteredStreams).toHaveLength(2);
    expect(result.current.filteredStreams.map(s => s.id)).toEqual(["stream_2", "stream_3"]);
  });

  it("filters by asset code", () => {
    const { result } = renderHook(() => useStreamFilter(mockStreams));
    
    act(() => {
      result.current.setFilter("assetCode", "XLM");
    });
    
    expect(result.current.filteredStreams).toHaveLength(1);
    expect(result.current.filteredStreams[0].id).toBe("stream_2");
  });

  it("applies multiple filters (AND logic)", () => {
    const { result } = renderHook(() => useStreamFilter(mockStreams));
    
    act(() => {
      result.current.setFilter("sender", "G_SENDER_1");
      result.current.setFilter("status", "active");
    });
    
    expect(result.current.filteredStreams).toHaveLength(1);
    expect(result.current.filteredStreams[0].id).toBe("stream_1");

    act(() => {
      result.current.setFilter("status", "scheduled");
    });

    expect(result.current.filteredStreams).toHaveLength(1);
    expect(result.current.filteredStreams[0].id).toBe("stream_3");
  });

  it("resets filters correctly", () => {
    const { result } = renderHook(() => useStreamFilter(mockStreams));
    
    act(() => {
      result.current.setFilter("status", "active");
      result.current.setFilter("sender", "G_SENDER_1");
    });
    
    expect(result.current.filteredStreams).toHaveLength(1);

    act(() => {
      result.current.setFilter("status", "");
      result.current.setFilter("sender", "");
    });
    
    expect(result.current.filteredStreams).toHaveLength(3);
  });

  it("initializes filters from URL", () => {
    window.history.replaceState(null, "", "/?status=active&sender=G_SENDER_1");
    
    const { result } = renderHook(() => useStreamFilter(mockStreams));
    
    expect(result.current.filters.status).toBe("active");
    expect(result.current.filters.sender).toBe("G_SENDER_1");
    expect(result.current.filteredStreams).toHaveLength(1);
    expect(result.current.filteredStreams[0].id).toBe("stream_1");
  });

  it("searches with q param (partial match across fields)", () => {
    const { result } = renderHook(() => useStreamFilter(mockStreams));
    
    // Search by ID
    act(() => {
      result.current.setFilter("q", "stream_1");
    });
    expect(result.current.filteredStreams).toHaveLength(1);
    expect(result.current.filteredStreams[0].id).toBe("stream_1");

    // Search by Sender
    act(() => {
      result.current.setFilter("q", "SENDER_2");
    });
    expect(result.current.filteredStreams).toHaveLength(1);
    expect(result.current.filteredStreams[0].id).toBe("stream_2");

    // Search by Asset
    act(() => {
      result.current.setFilter("q", "XLM");
    });
    expect(result.current.filteredStreams).toHaveLength(1);
    expect(result.current.filteredStreams[0].assetCode).toBe("XLM");

    // Search by substring matching multiple
    act(() => {
      result.current.setFilter("q", "RECIPIENT");
    });
    expect(result.current.filteredStreams).toHaveLength(3);
  });

  it("ignores whitespace-only queries and matches mixed-case queries", () => {
    const { result } = renderHook(() => useStreamFilter(mockStreams));

    act(() => {
      result.current.setFilter("q", "   ");
    });
    expect(result.current.filteredStreams).toEqual(mockStreams);

    act(() => {
      result.current.setFilter("q", "sEnDeR_2");
    });
    expect(result.current.filteredStreams.map((stream) => stream.id)).toEqual([
      "stream_2",
    ]);
  });
});
