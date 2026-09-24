/**
 * Tests for date range and actor address filters in StreamTimeline.
 * Feature: stream-timeline-filters (date range + actor search)
 *
 * Tests the pure computeFilteredEvents function with the new optional
 * dateRange and actorSearch parameters, plus wiring tests via StreamTimeline.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import * as fc from "fast-check";
import {
  computeFilteredEvents,
  makeEmptyFilters,
  hasActiveFilters,
  DateRangeFilter,
} from "./StreamTimeline";
import type { StreamEvent } from "../services/api";

// ---------------------------------------------------------------------------
// Mock the API module for wiring tests
// ---------------------------------------------------------------------------

vi.mock("../services/api", () => ({
  getStreamHistory: vi.fn(),
  listAllEvents: vi.fn(),
}));

import { listAllEvents } from "../services/api";
import { StreamTimeline } from "./StreamTimeline";

const mockListAllEvents = listAllEvents as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a unix timestamp (seconds) corresponding to midnight UTC of the given ISO date.
 * e.g. toUnixDay("2024-03-15") → 1710460800
 */
function toUnixDay(isoDate: string): number {
  return new Date(isoDate + "T00:00:00Z").getTime() / 1000;
}

function makeEvent(
  id: number,
  timestamp: number,
  actor?: string,
): StreamEvent {
  return {
    id,
    streamId: "s1",
    eventType: "created",
    timestamp,
    actor,
  };
}

// Fixed anchor dates for deterministic tests
const DAY_2024_01_01 = toUnixDay("2024-01-01"); // 1704067200
const DAY_2024_06_15 = toUnixDay("2024-06-15"); // 1718409600
const DAY_2024_12_31 = toUnixDay("2024-12-31"); // 1735603200

const EVENT_JAN = makeEvent(1, DAY_2024_01_01, "GBADDRJANUARYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
const EVENT_JUN = makeEvent(2, DAY_2024_06_15, "GBADDRJUNEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
const EVENT_DEC = makeEvent(3, DAY_2024_12_31, "GBADDRDECEMBERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

// ---------------------------------------------------------------------------
// makeEmptyFilters / hasActiveFilters utilities
// ---------------------------------------------------------------------------

describe("makeEmptyFilters", () => {
  it("returns empty set, empty date range, and empty actor search", () => {
    const f = makeEmptyFilters();
    expect(f.activeEventTypes.size).toBe(0);
    expect(f.dateRange.from).toBe("");
    expect(f.dateRange.to).toBe("");
    expect(f.actorSearch).toBe("");
  });
});

describe("hasActiveFilters", () => {
  it("returns false for empty filters", () => {
    expect(hasActiveFilters(makeEmptyFilters())).toBe(false);
  });

  it("returns true when event type filter is active", () => {
    const f = makeEmptyFilters();
    f.activeEventTypes.add("created");
    expect(hasActiveFilters(f)).toBe(true);
  });

  it("returns true when dateRange.from is set", () => {
    const f = makeEmptyFilters();
    f.dateRange.from = "2024-01-01";
    expect(hasActiveFilters(f)).toBe(true);
  });

  it("returns true when dateRange.to is set", () => {
    const f = makeEmptyFilters();
    f.dateRange.to = "2024-12-31";
    expect(hasActiveFilters(f)).toBe(true);
  });

  it("returns true when actorSearch is non-empty", () => {
    const f = makeEmptyFilters();
    f.actorSearch = "GBADDR";
    expect(hasActiveFilters(f)).toBe(true);
  });

  it("returns false when actorSearch is only whitespace", () => {
    const f = makeEmptyFilters();
    f.actorSearch = "   ";
    expect(hasActiveFilters(f)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Date range filter — unit tests
// ---------------------------------------------------------------------------

describe("computeFilteredEvents: date range filter", () => {
  const events = [EVENT_JAN, EVENT_JUN, EVENT_DEC];

  it("returns all events when no date range is provided", () => {
    const result = computeFilteredEvents(events, new Set());
    expect(result).toHaveLength(3);
  });

  it("returns all events when date range is empty strings", () => {
    const result = computeFilteredEvents(events, new Set(), { from: "", to: "" });
    expect(result).toHaveLength(3);
  });

  it("filters events on or after the 'from' date", () => {
    const result = computeFilteredEvents(events, new Set(), { from: "2024-06-15", to: "" });
    expect(result.map((e) => e.id)).toEqual([2, 3]);
  });

  it("filters events on or before the 'to' date (inclusive, full day)", () => {
    const result = computeFilteredEvents(events, new Set(), { from: "", to: "2024-06-15" });
    expect(result.map((e) => e.id)).toEqual([1, 2]);
  });

  it("filters events within a closed date range (both from and to)", () => {
    const result = computeFilteredEvents(events, new Set(), {
      from: "2024-06-15",
      to: "2024-06-15",
    });
    expect(result.map((e) => e.id)).toEqual([2]);
  });

  it("returns empty array when no events fall within the date range", () => {
    const result = computeFilteredEvents(events, new Set(), {
      from: "2025-01-01",
      to: "2025-12-31",
    });
    expect(result).toHaveLength(0);
  });

  it("includes event exactly at midnight on the 'from' day", () => {
    const result = computeFilteredEvents(
      [makeEvent(1, DAY_2024_06_15)],
      new Set(),
      { from: "2024-06-15", to: "" },
    );
    expect(result).toHaveLength(1);
  });

  it("includes event exactly at 23:59:59 on the 'to' day", () => {
    const endOfDay = toUnixDay("2024-06-15") + 86400 - 1;
    const result = computeFilteredEvents(
      [makeEvent(1, endOfDay)],
      new Set(),
      { from: "", to: "2024-06-15" },
    );
    expect(result).toHaveLength(1);
  });

  it("excludes event at midnight starting the day after 'to'", () => {
    const nextDayMidnight = toUnixDay("2024-06-16");
    const result = computeFilteredEvents(
      [makeEvent(1, nextDayMidnight)],
      new Set(),
      { from: "", to: "2024-06-15" },
    );
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Actor address search filter — unit tests
// ---------------------------------------------------------------------------

describe("computeFilteredEvents: actor address search filter", () => {
  const events = [EVENT_JAN, EVENT_JUN, EVENT_DEC];

  it("returns all events when actorSearch is empty", () => {
    const result = computeFilteredEvents(events, new Set(), undefined, "");
    expect(result).toHaveLength(3);
  });

  it("returns all events when actorSearch is only whitespace", () => {
    const result = computeFilteredEvents(events, new Set(), undefined, "   ");
    expect(result).toHaveLength(3);
  });

  it("returns matching events for exact full address", () => {
    const result = computeFilteredEvents(
      events,
      new Set(),
      undefined,
      EVENT_JAN.actor,
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("is case-insensitive", () => {
    const result = computeFilteredEvents(
      events,
      new Set(),
      undefined,
      "gbaddrjanuary",
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("matches on partial substring", () => {
    const result = computeFilteredEvents(events, new Set(), undefined, "GBADDR");
    expect(result).toHaveLength(3);
  });

  it("returns empty array when no actor matches", () => {
    const result = computeFilteredEvents(
      events,
      new Set(),
      undefined,
      "NOTFOUND",
    );
    expect(result).toHaveLength(0);
  });

  it("excludes events with no actor when a search term is provided", () => {
    const eventWithoutActor = makeEvent(99, DAY_2024_06_15, undefined);
    const result = computeFilteredEvents(
      [eventWithoutActor, EVENT_JAN],
      new Set(),
      undefined,
      "GBADDR",
    );
    expect(result.map((e) => e.id)).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// Combined filter logic — all three filters together
// ---------------------------------------------------------------------------

describe("computeFilteredEvents: combined filters", () => {
  const events: StreamEvent[] = [
    {
      id: 1,
      streamId: "s1",
      eventType: "created",
      timestamp: DAY_2024_01_01,
      actor: "GBADDRCREATED_JAN",
    },
    {
      id: 2,
      streamId: "s1",
      eventType: "claimed",
      timestamp: DAY_2024_06_15,
      actor: "GBADDRCLAIMED_JUN",
    },
    {
      id: 3,
      streamId: "s1",
      eventType: "canceled",
      timestamp: DAY_2024_12_31,
      actor: "GBADDRCANCELED_DEC",
    },
  ];

  it("event type + date range together narrow results correctly", () => {
    // Only "claimed" events, only within June
    const result = computeFilteredEvents(
      events,
      new Set<StreamEvent["eventType"]>(["claimed"]),
      { from: "2024-06-01", to: "2024-06-30" },
    );
    expect(result.map((e) => e.id)).toEqual([2]);
  });

  it("event type + actor search together narrow results correctly", () => {
    const result = computeFilteredEvents(
      events,
      new Set<StreamEvent["eventType"]>(["created", "claimed"]),
      undefined,
      "CLAIMED",
    );
    expect(result.map((e) => e.id)).toEqual([2]);
  });

  it("date range + actor search together narrow results correctly", () => {
    const result = computeFilteredEvents(
      events,
      new Set(),
      { from: "2024-06-01", to: "2024-12-31" },
      "DEC",
    );
    expect(result.map((e) => e.id)).toEqual([3]);
  });

  it("all three filters together narrow results to a single event", () => {
    const result = computeFilteredEvents(
      events,
      new Set<StreamEvent["eventType"]>(["claimed"]),
      { from: "2024-06-01", to: "2024-06-30" },
      "CLAIMED",
    );
    expect(result.map((e) => e.id)).toEqual([2]);
  });

  it("all three filters with no match returns empty array", () => {
    const result = computeFilteredEvents(
      events,
      new Set<StreamEvent["eventType"]>(["paused"]),
      { from: "2024-06-01", to: "2024-06-30" },
      "CLAIMED",
    );
    expect(result).toHaveLength(0);
  });

  it("clearing all filters (empty set, empty range, empty search) returns full sorted list", () => {
    const result = computeFilteredEvents(events, new Set(), { from: "", to: "" }, "");
    expect(result).toHaveLength(3);
    // sorted ascending by timestamp
    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(2);
    expect(result[2].id).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Property-based tests for date range filter
// ---------------------------------------------------------------------------

describe("computeFilteredEvents: date range — property-based", () => {
  const arbTimestamp = fc.integer({ min: 0, max: 2_000_000_000 });
  const arbEvent = fc.record<StreamEvent>({
    id: fc.integer({ min: 1, max: 1_000_000 }),
    streamId: fc.constant("s1"),
    eventType: fc.constant("created" as const),
    timestamp: arbTimestamp,
    actor: fc.option(fc.string({ minLength: 10, maxLength: 50 }), { nil: undefined }),
    amount: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
  });
  const arbEvents = fc.array(arbEvent, { minLength: 0, maxLength: 30 });

  it("all results satisfy the 'from' bound when set", () => {
    fc.assert(
      fc.property(arbEvents, fc.integer({ min: 0, max: 1_900_000_000 }), (events, fromTs) => {
        // Convert fromTs to an ISO date
        const isoFrom = new Date(fromTs * 1000).toISOString().slice(0, 10);
        const fromMs = new Date(isoFrom + "T00:00:00Z").getTime();
        const result = computeFilteredEvents(events, new Set(), { from: isoFrom, to: "" });
        return result.every((e) => e.timestamp * 1000 >= fromMs);
      }),
      { numRuns: 100 },
    );
  });

  it("all results satisfy the 'to' bound when set", () => {
    fc.assert(
      fc.property(arbEvents, fc.integer({ min: 0, max: 1_900_000_000 }), (events, toTs) => {
        const isoTo = new Date(toTs * 1000).toISOString().slice(0, 10);
        const toMs = new Date(isoTo + "T00:00:00Z").getTime() + 86_400_000 - 1;
        const result = computeFilteredEvents(events, new Set(), { from: "", to: isoTo });
        return result.every((e) => e.timestamp * 1000 <= toMs);
      }),
      { numRuns: 100 },
    );
  });

  it("no event is lost when date range exactly spans all event timestamps", () => {
    fc.assert(
      fc.property(fc.array(arbEvent, { minLength: 1, maxLength: 20 }), (events) => {
        const minTs = Math.min(...events.map((e) => e.timestamp));
        const maxTs = Math.max(...events.map((e) => e.timestamp));
        const isoFrom = new Date(minTs * 1000).toISOString().slice(0, 10);
        const isoTo = new Date(maxTs * 1000).toISOString().slice(0, 10);
        const result = computeFilteredEvents(events, new Set(), { from: isoFrom, to: isoTo });
        return result.length === events.length;
      }),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property-based tests for actor search filter
// ---------------------------------------------------------------------------

describe("computeFilteredEvents: actor search — property-based", () => {
  const arbActor = fc.string({ minLength: 20, maxLength: 56 });
  const arbEvent = (actor?: string) =>
    fc.record<StreamEvent>({
      id: fc.integer({ min: 1, max: 1_000_000 }),
      streamId: fc.constant("s1"),
      eventType: fc.constant("created" as const),
      timestamp: fc.integer({ min: 0, max: 2_000_000_000 }),
      actor: actor !== undefined ? fc.constant(actor) : fc.option(arbActor, { nil: undefined }),
      amount: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
    });

  it("all results contain the trimmed search term in their actor field (case-insensitive)", () => {
    fc.assert(
      fc.property(
        fc.array(arbEvent(), { minLength: 0, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 10 }),
        (events, search) => {
          // The implementation trims the search before checking, so we must match
          // against the trimmed lowercase value to correctly validate the output.
          const trimmedLower = search.trim().toLowerCase();
          if (trimmedLower === "") {
            // Whitespace-only search → no filtering → all events returned
            const result = computeFilteredEvents(events, new Set(), undefined, search);
            return result.length === events.length;
          }
          const result = computeFilteredEvents(events, new Set(), undefined, search);
          return result.every(
            (e) => e.actor !== undefined && e.actor.toLowerCase().includes(trimmedLower),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("result count never exceeds input count", () => {
    fc.assert(
      fc.property(
        fc.array(arbEvent(), { minLength: 0, maxLength: 20 }),
        fc.string({ minLength: 0, maxLength: 20 }),
        (events, search) => {
          const result = computeFilteredEvents(events, new Set(), undefined, search);
          return result.length <= events.length;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Wiring tests: date range filter in StreamTimeline
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("StreamTimeline wiring: date range filter", () => {
  it("filters out events outside the 'from' date (no extra API call)", async () => {
    // Jan event at unix 1704067200 → 2024-01-01
    // Jun event at unix 1718409600 → 2024-06-15
    mockListAllEvents.mockResolvedValue([EVENT_JAN, EVENT_JUN]);
    render(<StreamTimeline />);
    await waitFor(() => expect(screen.getAllByText("Stream created")).toHaveLength(2));

    // Both events visible initially
    expect(screen.getAllByText("Stream created")).toHaveLength(2);

    // Set "from" to 2024-06-01 — only JUN event should remain
    const fromInput = screen.getByLabelText("Filter from date");
    fireEvent.change(fromInput, { target: { value: "2024-06-01" } });

    expect(screen.getAllByText("Stream created")).toHaveLength(1);
    expect(mockListAllEvents).toHaveBeenCalledTimes(1);
  });

  it("filters out events outside the 'to' date (no extra API call)", async () => {
    mockListAllEvents.mockResolvedValue([EVENT_JAN, EVENT_DEC]);
    render(<StreamTimeline />);
    await waitFor(() => expect(screen.getAllByText("Stream created")).toHaveLength(2));

    // Set "to" to 2024-06-30 — only JAN event should remain
    const toInput = screen.getByLabelText("Filter to date");
    fireEvent.change(toInput, { target: { value: "2024-06-30" } });

    expect(screen.getAllByText("Stream created")).toHaveLength(1);
    expect(mockListAllEvents).toHaveBeenCalledTimes(1);
  });

  it("shows filtered-empty state when date range excludes all events", async () => {
    mockListAllEvents.mockResolvedValue([EVENT_JAN]);
    render(<StreamTimeline />);
    await waitFor(() => expect(screen.getByText("Stream created")).toBeTruthy());

    const fromInput = screen.getByLabelText("Filter from date");
    fireEvent.change(fromInput, { target: { value: "2025-01-01" } });

    expect(screen.getByText(/No events match the selected filters/i)).toBeTruthy();
  });

  it("restores full list after clearing date range", async () => {
    mockListAllEvents.mockResolvedValue([EVENT_JAN, EVENT_DEC]);
    render(<StreamTimeline />);
    await waitFor(() => expect(screen.getAllByText("Stream created")).toHaveLength(2));

    const toInput = screen.getByLabelText("Filter to date");
    fireEvent.change(toInput, { target: { value: "2024-06-30" } });
    expect(screen.getAllByText("Stream created")).toHaveLength(1);

    fireEvent.click(screen.getByText("Clear filters"));
    expect(screen.getAllByText("Stream created")).toHaveLength(2);
    expect(mockListAllEvents).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Wiring tests: actor address search in StreamTimeline
// ---------------------------------------------------------------------------

describe("StreamTimeline wiring: actor address search filter", () => {
  it("filters events by actor address substring (no extra API call)", async () => {
    const actorA = "GBADDRACTORA00000000000000000000000000000000000000000000000";
    const actorB = "GBADDRACTORB00000000000000000000000000000000000000000000000";
    const evA: StreamEvent = { id: 1, streamId: "s1", eventType: "created", timestamp: 1000, actor: actorA };
    const evB: StreamEvent = { id: 2, streamId: "s1", eventType: "claimed", timestamp: 2000, actor: actorB };

    mockListAllEvents.mockResolvedValue([evA, evB]);
    render(<StreamTimeline />);
    await waitFor(() => expect(screen.getByText("Stream created")).toBeTruthy());

    const actorInput = screen.getByLabelText("Filter by actor address");
    fireEvent.change(actorInput, { target: { value: "ACTORB" } });

    // Only claimed event (actorB) should be visible
    expect(screen.queryByText("Stream created")).toBeNull();
    expect(screen.getByText("Stream claimed")).toBeTruthy();
    expect(mockListAllEvents).toHaveBeenCalledTimes(1);
  });

  it("is case-insensitive for actor search", async () => {
    const actor = "GBADDRACTORA00000000000000000000000000000000000000000000000";
    const ev: StreamEvent = { id: 1, streamId: "s1", eventType: "created", timestamp: 1000, actor };

    mockListAllEvents.mockResolvedValue([ev]);
    render(<StreamTimeline />);
    await waitFor(() => expect(screen.getByText("Stream created")).toBeTruthy());

    const actorInput = screen.getByLabelText("Filter by actor address");
    fireEvent.change(actorInput, { target: { value: "actora" } });
    expect(screen.getByText("Stream created")).toBeTruthy();
  });

  it("shows filtered-empty state when no actor matches search", async () => {
    const ev: StreamEvent = {
      id: 1, streamId: "s1", eventType: "created", timestamp: 1000, actor: "GBADDRACTORA00000000",
    };
    mockListAllEvents.mockResolvedValue([ev]);
    render(<StreamTimeline />);
    await waitFor(() => expect(screen.getByText("Stream created")).toBeTruthy());

    const actorInput = screen.getByLabelText("Filter by actor address");
    fireEvent.change(actorInput, { target: { value: "NOTPRESENT" } });

    expect(screen.getByText(/No events match the selected filters/i)).toBeTruthy();
  });

  it("restores full list after clearing actor search", async () => {
    const actorA = "GBADDRACTORA00000000000000000000000000000000000000000000000";
    const actorB = "GBADDRACTORB00000000000000000000000000000000000000000000000";
    const evA: StreamEvent = { id: 1, streamId: "s1", eventType: "created", timestamp: 1000, actor: actorA };
    const evB: StreamEvent = { id: 2, streamId: "s1", eventType: "claimed", timestamp: 2000, actor: actorB };

    mockListAllEvents.mockResolvedValue([evA, evB]);
    render(<StreamTimeline />);
    await waitFor(() => expect(screen.getByText("Stream created")).toBeTruthy());

    const actorInput = screen.getByLabelText("Filter by actor address");
    fireEvent.change(actorInput, { target: { value: "ACTORB" } });
    expect(screen.queryByText("Stream created")).toBeNull();

    fireEvent.click(screen.getByText("Clear filters"));
    expect(screen.getByText("Stream created")).toBeTruthy();
    expect(screen.getByText("Stream claimed")).toBeTruthy();
    expect(mockListAllEvents).toHaveBeenCalledTimes(1);
  });
});
