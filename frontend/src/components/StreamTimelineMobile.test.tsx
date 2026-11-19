import React from "react";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamTimeline } from "./StreamTimeline";
import { getStreamHistory, listAllEvents, StreamEvent } from "../services/api";

vi.mock("../services/api", () => ({
  getStreamHistory: vi.fn(),
  listAllEvents: vi.fn(),
}));

const mockEvents: StreamEvent[] = [
  {
    id: 201,
    streamId: "stream-mobile-test-1001",
    eventType: "created",
    timestamp: 1700000000,
    amount: 5000,
    actor: "GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6",
  },
  {
    id: 202,
    streamId: "stream-mobile-test-1001",
    eventType: "claimed",
    timestamp: 1700000000,
    amount: 1500,
    actor: "GDBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E",
  },
  {
    id: 203,
    streamId: "stream-mobile-test-1001",
    eventType: "paused",
    timestamp: 1700007200,
    actor: "GC7Y4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6",
  },
];

describe("StreamTimeline mobile usability on narrow screens (SSB-2026-059)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStreamHistory).mockResolvedValue(mockEvents);
    vi.mocked(listAllEvents).mockResolvedValue(mockEvents);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders timeline container with overflow protection on 320px narrow viewport", async () => {
    render(
      <div style={{ width: "320px", overflowX: "hidden" }}>
        <StreamTimeline streamId="stream-mobile-test-1001" />
      </div>
    );

    const feed = await screen.findByTestId("timeline-activity-feed");
    expect(feed).toBeInTheDocument();
    expect(feed).toHaveStyle({ maxWidth: "100%", overflowX: "hidden" });
  });

  it("enforces minimum 44px touch targets on all filter buttons", async () => {
    render(
      <div style={{ width: "320px" }}>
        <StreamTimeline streamId="stream-mobile-test-1001" />
      </div>
    );

    await screen.findByTestId("timeline-activity-feed");
    const createdFilterBtn = screen.getByTestId("filter-btn-created");
    expect(createdFilterBtn).toBeInTheDocument();
    expect(createdFilterBtn).toHaveStyle({ minHeight: "44px", minWidth: "44px" });

    const claimedFilterBtn = screen.getByTestId("filter-btn-claimed");
    expect(claimedFilterBtn).toHaveStyle({ minHeight: "44px", minWidth: "44px" });
  });

  it("enforces minimum 44px touch target on clear filters button when active", async () => {
    render(
      <div style={{ width: "320px" }}>
        <StreamTimeline streamId="stream-mobile-test-1001" />
      </div>
    );

    await screen.findByTestId("timeline-activity-feed");
    const createdFilterBtn = screen.getByTestId("filter-btn-created");
    fireEvent.click(createdFilterBtn);

    const clearBtn = await screen.findByTestId("timeline-clear-filters-btn");
    expect(clearBtn).toBeInTheDocument();
    expect(clearBtn).toHaveStyle({ minHeight: "44px", minWidth: "44px" });
  });

  it("enforces minimum 44px touch target on refresh button in global feed mode", async () => {
    render(
      <div style={{ width: "320px" }}>
        <StreamTimeline />
      </div>
    );

    const refreshBtn = await screen.findByTestId("timeline-refresh-btn");
    expect(refreshBtn).toBeInTheDocument();
    expect(refreshBtn).toHaveStyle({ minHeight: "44px", minWidth: "44px" });
  });

  it("renders concurrent event badges and long addresses safely on 320px viewport", async () => {
    render(
      <div style={{ width: "320px", overflowX: "hidden" }}>
        <StreamTimeline streamId="stream-mobile-test-1001" />
      </div>
    );

    const item1 = await screen.findByTestId("activity-item-201");
    expect(item1).toBeInTheDocument();
    expect(item1).toHaveStyle({ minWidth: "0px", maxWidth: "100%" });

    const badges = screen.getAllByTestId("concurrent-event-badge");
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0]).toHaveTextContent("Simultaneous event");
  });

  it("renders clean responsive layout on 768px tablet viewport without clipping", async () => {
    render(
      <div style={{ width: "768px" }}>
        <StreamTimeline streamId="stream-mobile-test-1001" />
      </div>
    );

    const feed = await screen.findByTestId("timeline-activity-feed");
    expect(feed).toBeInTheDocument();

    const items = screen.getAllByRole("article");
    expect(items.length).toBe(3);
    items.forEach((item) => {
      expect(item).toHaveStyle({ maxWidth: "100%" });
    });
  });
});
