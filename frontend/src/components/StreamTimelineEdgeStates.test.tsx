import React from "react";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamTimeline, computeFilteredEvents, isConcurrentEvent } from "./StreamTimeline";
import { getStreamHistory, listAllEvents, StreamEvent } from "../services/api";

vi.mock("../services/api", () => ({
  getStreamHistory: vi.fn(),
  listAllEvents: vi.fn(),
}));

describe("StreamTimeline edge and failure states (SSB-2026-060)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("handles two events with the same timestamp with stable sorting and concurrent badges", async () => {
    const concurrentEvents: StreamEvent[] = [
      {
        id: 502,
        streamId: "stream-edge-1002",
        eventType: "claimed",
        timestamp: 1710000000,
        amount: 250,
        actor: "GDBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E",
      },
      {
        id: 501,
        streamId: "stream-edge-1002",
        eventType: "created",
        timestamp: 1710000000,
        amount: 1000,
        actor: "GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6",
      },
    ];

    // Unit level check for deterministic sorting
    const sorted = computeFilteredEvents(concurrentEvents, new Set());
    expect(sorted[0].id).toBe(501);
    expect(sorted[1].id).toBe(502);

    expect(isConcurrentEvent(concurrentEvents[0], concurrentEvents)).toBe(true);
    expect(isConcurrentEvent(concurrentEvents[1], concurrentEvents)).toBe(true);

    vi.mocked(getStreamHistory).mockResolvedValue(concurrentEvents);

    render(<StreamTimeline streamId="stream-edge-1002" />);

    const item501 = await screen.findByTestId("activity-item-501");
    const item502 = await screen.findByTestId("activity-item-502");
    expect(item501).toBeInTheDocument();
    expect(item502).toBeInTheDocument();

    const badges = screen.getAllByTestId("concurrent-event-badge");
    expect(badges.length).toBe(2);
    expect(badges[0]).toHaveTextContent("Simultaneous event");
    expect(badges[1]).toHaveTextContent("Simultaneous event");
  });

  it("renders independent loading skeleton before history resolves without blocking", async () => {
    let resolveHistory: (val: StreamEvent[]) => void;
    const historyPromise = new Promise<StreamEvent[]>((res) => {
      resolveHistory = res;
    });

    vi.mocked(getStreamHistory).mockReturnValue(historyPromise);

    render(<StreamTimeline streamId="stream-edge-1002" />);

    const loadingState = screen.getByTestId("timeline-loading-state");
    expect(loadingState).toBeInTheDocument();
    expect(loadingState).toHaveAttribute("role", "status");
    expect(screen.getByText("Loading event history…")).toBeInTheDocument();

    // Resolve independently
    resolveHistory!([
      {
        id: 601,
        streamId: "stream-edge-1002",
        eventType: "created",
        timestamp: 1710005000,
        amount: 500,
      },
    ]);

    await waitFor(() => {
      expect(screen.queryByTestId("timeline-loading-state")).not.toBeInTheDocument();
    });

    expect(screen.getByTestId("activity-item-601")).toBeInTheDocument();
  });

  it("handles history fetch failure gracefully with actionable retry", async () => {
    vi.mocked(getStreamHistory).mockRejectedValueOnce(new Error("Network timeout: 504 Gateway Timeout"));

    render(<StreamTimeline streamId="stream-edge-1002" />);

    const errorState = await screen.findByTestId("timeline-error-state");
    expect(errorState).toBeInTheDocument();
    expect(screen.getByTestId("timeline-error-title")).toHaveTextContent("Unable to load activity");
    expect(screen.getByTestId("timeline-error-message")).toHaveTextContent("Network timeout: 504 Gateway Timeout");

    // Click retry
    vi.mocked(getStreamHistory).mockResolvedValueOnce([
      {
        id: 701,
        streamId: "stream-edge-1002",
        eventType: "created",
        timestamp: 1710010000,
      },
    ]);

    const retryBtn = screen.getByTestId("timeline-retry-btn");
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("timeline-error-state")).not.toBeInTheDocument();
    });

    expect(screen.getByTestId("activity-item-701")).toBeInTheDocument();
  });

  it("renders empty state correctly when history returns zero events", async () => {
    vi.mocked(getStreamHistory).mockResolvedValue([]);

    render(<StreamTimeline streamId="stream-edge-1002" />);

    await waitFor(() => {
      expect(screen.queryByTestId("timeline-loading-state")).not.toBeInTheDocument();
    });

    expect(screen.getByText("No activity to show yet.")).toBeInTheDocument();
  });

  it("renders filtered empty state and allows resetting filters", async () => {
    const singleEvent: StreamEvent[] = [
      {
        id: 801,
        streamId: "stream-edge-1002",
        eventType: "created",
        timestamp: 1710020000,
      },
    ];

    vi.mocked(getStreamHistory).mockResolvedValue(singleEvent);

    render(<StreamTimeline streamId="stream-edge-1002" />);

    await screen.findByTestId("activity-item-801");

    // Filter by 'claimed'
    const claimedFilterBtn = screen.getByRole("button", { name: "Filter by Claimed" });
    fireEvent.click(claimedFilterBtn);

    expect(
      screen.getByText("No events match the selected filters. Clear filters to see all events.")
    ).toBeInTheDocument();

    const clearBtn = screen.getByRole("button", { name: "Clear filters" });
    fireEvent.click(clearBtn);

    expect(await screen.findByTestId("activity-item-801")).toBeInTheDocument();
  });
});
