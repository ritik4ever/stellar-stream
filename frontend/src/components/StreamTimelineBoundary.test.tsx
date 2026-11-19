import React from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  StreamTimeline,
  computeFilteredEvents,
  isConcurrentEvent,
} from "./StreamTimeline";
import { getStreamHistory, listAllEvents, StreamEvent } from "../services/api";

vi.mock("../services/api", () => ({
  getStreamHistory: vi.fn(),
  listAllEvents: vi.fn(),
}));

describe("StreamTimeline boundary state and concurrent event handling (SSB-2026-056)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("deterministically sorts events with identical timestamps using event id", () => {
    const events: StreamEvent[] = [
      { id: 202, streamId: "s1", eventType: "claimed", timestamp: 1700000000, amount: 50 },
      { id: 101, streamId: "s1", eventType: "created", timestamp: 1700000000, amount: 100 },
      { id: 303, streamId: "s1", eventType: "paused", timestamp: 1700000500 },
    ];

    const sorted = computeFilteredEvents(events, new Set());
    expect(sorted.map((e) => e.id)).toEqual([101, 202, 303]);
  });

  it("identifies concurrent events having the exact same timestamp", () => {
    const events: StreamEvent[] = [
      { id: 1, streamId: "s1", eventType: "created", timestamp: 1700000000 },
      { id: 2, streamId: "s1", eventType: "claimed", timestamp: 1700000000 },
      { id: 3, streamId: "s1", eventType: "canceled", timestamp: 1700001000 },
    ];

    expect(isConcurrentEvent(events[0], events)).toBe(true);
    expect(isConcurrentEvent(events[1], events)).toBe(true);
    expect(isConcurrentEvent(events[2], events)).toBe(false);
  });

  it("renders explicit 'Simultaneous event' badge when two events share the same timestamp", async () => {
    const events: StreamEvent[] = [
      {
        id: 10,
        streamId: "stream-concurrent",
        eventType: "created",
        timestamp: 1700000000,
        amount: 500,
      },
      {
        id: 11,
        streamId: "stream-concurrent",
        eventType: "claimed",
        timestamp: 1700000000,
        amount: 100,
      },
      {
        id: 12,
        streamId: "stream-concurrent",
        eventType: "paused",
        timestamp: 1700002000,
      },
    ];

    vi.mocked(getStreamHistory).mockResolvedValue(events);

    render(<StreamTimeline streamId="stream-concurrent" />);

    await waitFor(() => {
      expect(screen.getByText("Stream created")).toBeInTheDocument();
    });

    const concurrentBadges = screen.getAllByTestId("concurrent-event-badge");
    expect(concurrentBadges).toHaveLength(2);
    expect(concurrentBadges[0]).toHaveTextContent("Simultaneous event");
    expect(concurrentBadges[1]).toHaveTextContent("Simultaneous event");
  });

  it("renders accessible loading skeleton when history loads independently of stream details", () => {
    vi.mocked(getStreamHistory).mockImplementation(
      () => new Promise(() => {}) // never resolves to hold loading state
    );

    render(<StreamTimeline streamId="stream-loading" />);

    const loadingState = screen.getByTestId("timeline-loading-state");
    expect(loadingState).toBeInTheDocument();
    expect(loadingState).toHaveAttribute("role", "status");
    expect(loadingState).toHaveAttribute("aria-label", "Loading event history");
  });
});
