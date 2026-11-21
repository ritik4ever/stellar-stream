import React from "react";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamTimeline } from "./StreamTimeline";
import { getStreamHistory, StreamEvent } from "../services/api";

vi.mock("../services/api", () => ({
  getStreamHistory: vi.fn(),
  listAllEvents: vi.fn(),
}));

const mockEvents: StreamEvent[] = [
  {
    id: 101,
    streamId: "stream-a11y-test",
    eventType: "created",
    timestamp: 1700000000,
    amount: 1000,
    actor: "GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6",
  },
  {
    id: 102,
    streamId: "stream-a11y-test",
    eventType: "claimed",
    timestamp: 1700000000,
    amount: 200,
    actor: "GDBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E",
  },
  {
    id: 103,
    streamId: "stream-a11y-test",
    eventType: "paused",
    timestamp: 1700003600,
  },
];

describe("StreamTimeline accessibility and screen reader support (SSB-2026-058)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStreamHistory).mockResolvedValue(mockEvents);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders polite live announcer with total count and filter status", async () => {
    render(<StreamTimeline streamId="stream-a11y-test" />);

    const announcer = await screen.findByTestId("timeline-a11y-announcer");
    expect(announcer).toBeInTheDocument();
    expect(announcer).toHaveAttribute("role", "status");
    expect(announcer).toHaveAttribute("aria-live", "polite");
    expect(announcer).toHaveTextContent("Showing 3 events.");
  });

  it("renders keyboard-focusable event articles with accessible labeling and posinset", async () => {
    render(<StreamTimeline streamId="stream-a11y-test" />);

    const feed = await screen.findByRole("feed", { name: /stream event timeline/i });
    expect(feed).toBeInTheDocument();

    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(3);

    // Each article is focusable via keyboard Tab navigation
    expect(articles[0]).toHaveAttribute("tabindex", "0");
    expect(articles[0]).toHaveAttribute("aria-posinset", "1");
    expect(articles[0]).toHaveAttribute("aria-setsize", "3");
    expect(articles[0]).toHaveAttribute("aria-labelledby", "event-title-101");

    articles[0].focus();
    expect(document.activeElement).toBe(articles[0]);
  });

  it("provides accessible filter controls and updates screen reader announcer on toggle", async () => {
    render(<StreamTimeline streamId="stream-a11y-test" />);

    await screen.findByRole("feed");

    const createdBtn = screen.getByRole("button", { name: "Filter by Created" });
    expect(createdBtn).toHaveAttribute("aria-pressed", "false");

    // Toggle filter
    fireEvent.click(createdBtn);
    expect(createdBtn).toHaveAttribute("aria-pressed", "true");

    const announcer = screen.getByTestId("timeline-a11y-announcer");
    expect(announcer).toHaveTextContent("Showing 1 events. Filtered by created.");
  });

  it("hides decorative icons from screen readers and provides accessible concurrent label", async () => {
    render(<StreamTimeline streamId="stream-a11y-test" />);

    await screen.findByRole("feed");

    const concurrentBadge = screen.getAllByTestId("concurrent-event-badge")[0];
    expect(concurrentBadge).toHaveAttribute(
      "aria-label",
      "Simultaneous event occurred at the same ledger timestamp"
    );

    const icons = document.querySelectorAll(".activity-icon");
    icons.forEach((icon) => {
      expect(icon).toHaveAttribute("aria-hidden", "true");
    });
  });
});
