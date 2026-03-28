/**
 * Unit tests for StreamTimeline wiring: FilterBar integration and empty-state messaging.
 * Requirements: 4.1, 4.2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import { StreamTimeline } from "./StreamTimeline";
import type { StreamEvent } from "../services/api";

// ---------------------------------------------------------------------------
// Mock the API module
// ---------------------------------------------------------------------------

vi.mock("../services/api", () => ({
  getStreamHistory: vi.fn(),
  listAllEvents: vi.fn(),
}));

import { listAllEvents } from "../services/api";

const mockListAllEvents = listAllEvents as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const makeEvent = (id: number, eventType: StreamEvent["eventType"]): StreamEvent => ({
  id,
  streamId: "stream-abc",
  eventType,
  timestamp: 1_700_000_000 + id,
  actor: "0x1234567890abcdef1234567890abcdef12345678",
  amount: 100,
});

const CREATED_EVENT = makeEvent(1, "created");
const CLAIMED_EVENT = makeEvent(2, "claimed");
const CANCELED_EVENT = makeEvent(3, "canceled");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveWith(events: StreamEvent[]) {
  mockListAllEvents.mockResolvedValue(events);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("StreamTimeline wiring: FilterBar is rendered", () => {
  it("renders the FilterBar with all four toggle buttons after loading", async () => {
    resolveWith([CREATED_EVENT]);
    render(<StreamTimeline />);
    await waitFor(() => expect(screen.queryByText("Loading history...")).toBeNull());

    expect(screen.getByText("Created")).toBeTruthy();
    expect(screen.getByText("Claimed")).toBeTruthy();
    expect(screen.getByText("Canceled")).toBeTruthy();
    expect(screen.getByText("Start Time Updated")).toBeTruthy();
  });

  it("does not render FilterBar while loading", async () => {
    // Never resolves during this test
    mockListAllEvents.mockReturnValue(new Promise(() => {}));
    render(<StreamTimeline />);
    expect(screen.getByText("Loading history...")).toBeTruthy();
    expect(screen.queryByText("Created")).toBeNull();
  });
});

describe("StreamTimeline wiring: filtered empty-state message", () => {
  it("shows filtered empty-state when events don't match active filters", async () => {
    resolveWith([CREATED_EVENT]);
    render(<StreamTimeline />);
    await waitFor(() => expect(screen.queryByText("Loading history...")).toBeNull());

    // Activate "Claimed" filter — no claimed events exist
    fireEvent.click(screen.getByText("Claimed"));

    expect(
      screen.getByText(/No events match the selected filters/i),
    ).toBeTruthy();
  });

  it("does NOT show filtered empty-state when loading", async () => {
    mockListAllEvents.mockReturnValue(new Promise(() => {}));
    render(<StreamTimeline />);
    expect(screen.queryByText(/No events match the selected filters/i)).toBeNull();
  });

  it("does NOT show filtered empty-state when events array is empty with no filters", async () => {
    resolveWith([]);
    render(<StreamTimeline />);
    await waitFor(() => expect(screen.queryByText("Loading history...")).toBeNull());

    expect(screen.queryByText(/No events match the selected filters/i)).toBeNull();
    expect(screen.getByText("No events found")).toBeTruthy();
  });

  it("filtered empty-state is distinct from the no-events message", async () => {
    resolveWith([CREATED_EVENT]);
    render(<StreamTimeline />);
    await waitFor(() => expect(screen.queryByText("Loading history...")).toBeNull());

    fireEvent.click(screen.getByText("Claimed"));

    expect(screen.queryByText("No events found")).toBeNull();
    expect(
      screen.getByText(/No events match the selected filters/i),
    ).toBeTruthy();
  });

  it("filtered empty-state is distinct from the loading message", async () => {
    resolveWith([CREATED_EVENT]);
    render(<StreamTimeline />);
    await waitFor(() => expect(screen.queryByText("Loading history...")).toBeNull());

    fireEvent.click(screen.getByText("Claimed"));

    expect(screen.queryByText("Loading history...")).toBeNull();
    expect(
      screen.getByText(/No events match the selected filters/i),
    ).toBeTruthy();
  });
});

describe("StreamTimeline wiring: event list updates without extra API calls", () => {
  it("updates the event list immediately when a filter is toggled (no extra API calls)", async () => {
    resolveWith([CREATED_EVENT, CLAIMED_EVENT, CANCELED_EVENT]);
    render(<StreamTimeline />);
    await waitFor(() => expect(screen.queryByText("Loading history...")).toBeNull());

    // Initially all events visible — API called once
    expect(mockListAllEvents).toHaveBeenCalledTimes(1);

    // Toggle "Claimed" filter
    fireEvent.click(screen.getByText("Claimed"));

    // Still only one API call
    expect(mockListAllEvents).toHaveBeenCalledTimes(1);

    // Only claimed event description should be visible
    expect(screen.getByText(/Claim of/i)).toBeTruthy();
    expect(screen.queryByText(/Initiated by/i)).toBeNull();
    expect(screen.queryByText(/Closed by/i)).toBeNull();
  });

  it("restores full list when Clear filters is clicked (no extra API calls)", async () => {
    resolveWith([CREATED_EVENT, CLAIMED_EVENT]);
    render(<StreamTimeline />);
    await waitFor(() => expect(screen.queryByText("Loading history...")).toBeNull());

    fireEvent.click(screen.getByText("Claimed"));
    expect(screen.queryByText(/Initiated by/i)).toBeNull();

    fireEvent.click(screen.getByText("Clear filters"));

    expect(mockListAllEvents).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Initiated by/i)).toBeTruthy();
    expect(screen.getByText(/Claim of/i)).toBeTruthy();
  });
});
