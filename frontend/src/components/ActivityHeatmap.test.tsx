import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { ActivityHeatmap } from "./ActivityHeatmap";
import type { StreamEvent } from "../services/api";

vi.mock("../services/api", () => ({
  listAllEvents: vi.fn(),
}));

import { listAllEvents } from "../services/api";

const mockListAllEvents = listAllEvents as ReturnType<typeof vi.fn>;

const makeEvent = (id: number, eventType: StreamEvent["eventType"], timestamp: number): StreamEvent => ({
  id,
  streamId: "stream-1",
  eventType,
  timestamp,
});

/** A timestamp for a specific local calendar date at noon to avoid TZ edge cases. */
function at(y: number, m: number, d: number): number {
  return new Date(y, m - 1, d, 12, 0, 0).getTime() / 1000;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("ActivityHeatmap", () => {
  it("shows a loading state while fetching", async () => {
    mockListAllEvents.mockReturnValue(new Promise(() => {}));
    render(<ActivityHeatmap />);
    expect(screen.getByText(/Loading activity/i)).toBeTruthy();
  });

  it("renders the heatmap grid populated from fetched events", async () => {
    mockListAllEvents.mockResolvedValue([makeEvent(1, "created", at(2026, 7, 15))]);
    render(<ActivityHeatmap />);
    await waitFor(() => expect(screen.queryByText(/Loading activity/i)).toBeNull());

    // Each of the 52 weeks x 7 days = 364 day cells.
    const cells = screen.getAllByRole("img");
    expect(cells.length).toBe(364);
  });

  it("counts only created/claimed/canceled events and ignores other event types", async () => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const mid = now.getTime() / 1000 + 12 * 3600;

    mockListAllEvents.mockResolvedValue([
      makeEvent(1, "created", mid),
      makeEvent(2, "claimed", mid),
      makeEvent(3, "canceled", mid),
      makeEvent(4, "paused", mid), // ignored
    ]);

    render(<ActivityHeatmap />);
    await waitFor(() => expect(screen.queryByText(/Loading activity/i)).toBeNull());

    expect(screen.getByText(/3 activity events in the last 12 months/i)).toBeTruthy();

    // The day cell's aria-label reflects the activity count.
    const todayFmt = now.toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    expect(screen.getByLabelText(`${todayFmt}: 3 stream events`)).toBeTruthy();
  });

  it("renders gray cells for empty days with an accessible 'no activity' label", async () => {
    mockListAllEvents.mockResolvedValue([makeEvent(1, "created", at(2026, 1, 1))]);
    render(<ActivityHeatmap />);
    await waitFor(() => expect(screen.queryByText(/Loading activity/i)).toBeNull());

    // The first cell of the grid is a real past day with no events.
    const cells = screen.getAllByRole("img");
    const first = cells[0];
    expect(first.getAttribute("aria-label")).toMatch(/no activity/i);
    // Empty days render as gray (level 0) rather than transparent.
    const style = first.getAttribute("style") ?? "";
    expect(style).toMatch(/background-color:\s*#e5e7eb|rgb\(229\s*,\s*231\s*,\s*235\)/);
  });

  it("renders empty state when no events exist", async () => {
    mockListAllEvents.mockResolvedValue([]);
    render(<ActivityHeatmap />);
    await waitFor(() => expect(screen.queryByText(/Loading activity/i)).toBeNull());
    expect(screen.getByText(/0 activity events in the last 12 months/i)).toBeTruthy();
  });

  it("renders an error state with a retry button", async () => {
    mockListAllEvents.mockRejectedValue(new Error("Network down"));
    render(<ActivityHeatmap />);
    await waitFor(() => expect(screen.getByText(/Network down/i)).toBeTruthy());

    const retry = screen.getByText(/Try again/i);
    expect(retry).toBeTruthy();

    // Retry refetches and renders.
    mockListAllEvents.mockResolvedValue([]);
    retry.click();
    await waitFor(() => expect(screen.getByText(/0 activity events/i)).toBeTruthy());
    expect(mockListAllEvents).toHaveBeenCalledTimes(2);
  });

  it("supports injected events via the events prop without fetching", async () => {
    render(
      <ActivityHeatmap
        events={[makeEvent(1, "claimed", at(2026, 7, 15))]}
        loading={false}
      />,
    );
    expect(mockListAllEvents).not.toHaveBeenCalled();
    expect(screen.getAllByRole("img").length).toBe(364);
    expect(screen.getByText(/1 activity event in the last 12 months/i)).toBeTruthy();
  });
});