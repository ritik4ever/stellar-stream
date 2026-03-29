/**
 * Property-based tests for StreamTimeline filter logic.
 * Feature: stream-timeline-filters
 *
 * Tests the pure functions: computeFilteredEvents, toggleFilter, clearFilters
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  computeFilteredEvents,
  toggleFilter,
  clearFilters,
  EventType,
} from "./StreamTimeline";
import type { StreamEvent } from "../services/api";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const EVENT_TYPES: EventType[] = [
  "created",
  "claimed",
  "canceled",
  "start_time_updated",
];

const arbEventType = fc.constantFrom(...EVENT_TYPES);

const arbStreamEvent = fc.record<StreamEvent>({
  id: fc.integer({ min: 1, max: 1_000_000 }),
  streamId: fc.string({ minLength: 8, maxLength: 16 }),
  eventType: arbEventType,
  timestamp: fc.integer({ min: 0, max: 2_000_000_000 }),
  actor: fc.option(fc.string({ minLength: 40, maxLength: 40 }), {
    nil: undefined,
  }),
  amount: fc.option(fc.integer({ min: 1, max: 1_000_000 }), { nil: undefined }),
});

const arbStreamEvents = fc.array(arbStreamEvent, { minLength: 0, maxLength: 50 });

/** Generates a non-empty subset of EVENT_TYPES as a Set */
const arbNonEmptyFilterSet = fc
  .subarray(EVENT_TYPES, { minLength: 1 })
  .map((arr) => new Set(arr) as Set<EventType>);

/** Generates any subset (possibly empty) of EVENT_TYPES as a Set */
const arbFilterSet = fc
  .subarray(EVENT_TYPES, { minLength: 0 })
  .map((arr) => new Set(arr) as Set<EventType>);

/** Generates a non-empty subset of size >= 2 */
const arbMultiFilterSet = fc
  .subarray(EVENT_TYPES, { minLength: 2 })
  .map((arr) => new Set(arr) as Set<EventType>);

// ---------------------------------------------------------------------------
// Property 1: Filtered events match active filters
// Validates: Requirements 2.3, 3.2
// ---------------------------------------------------------------------------

describe(
  "Feature: stream-timeline-filters, Property 1: Filtered events match active filters",
  () => {
    it("every event in filteredEvents has an eventType in activeFilters", () => {
      fc.assert(
        fc.property(arbStreamEvents, arbNonEmptyFilterSet, (events, activeFilters) => {
          const result = computeFilteredEvents(events, activeFilters);
          return result.every((e) => activeFilters.has(e.eventType));
        }),
        { numRuns: 100 },
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Property 2: No active filters shows all events
// Validates: Requirements 5.3
// ---------------------------------------------------------------------------

describe(
  "Feature: stream-timeline-filters, Property 2: No active filters shows all events",
  () => {
    it("filteredEvents equals the full list when activeFilters is empty", () => {
      fc.assert(
        fc.property(arbStreamEvents, (events) => {
          const result = computeFilteredEvents(events, new Set());
          return (
            result.length === events.length &&
            result.every((e, i) => e === events[i])
          );
        }),
        { numRuns: 100 },
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Property 3: Toggle is an involution (round-trip)
// Validates: Requirements 2.1, 2.2
// ---------------------------------------------------------------------------

describe(
  "Feature: stream-timeline-filters, Property 3: Toggle is an involution (round-trip)",
  () => {
    it("toggling the same type twice returns the original set", () => {
      fc.assert(
        fc.property(arbFilterSet, arbEventType, (activeFilters, type) => {
          const after = toggleFilter(toggleFilter(activeFilters, type), type);
          // Sets must have the same members
          if (after.size !== activeFilters.size) return false;
          for (const t of activeFilters) {
            if (!after.has(t)) return false;
          }
          return true;
        }),
        { numRuns: 100 },
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Property 4: Multi-select union correctness
// Validates: Requirements 3.1, 3.2
// ---------------------------------------------------------------------------

describe(
  "Feature: stream-timeline-filters, Property 4: Multi-select union correctness",
  () => {
    it("filteredEvents contains exactly the events whose eventType is in the union", () => {
      fc.assert(
        fc.property(arbStreamEvents, arbMultiFilterSet, (events, activeFilters) => {
          const result = computeFilteredEvents(events, activeFilters);
          const expected = events.filter((e) => activeFilters.has(e.eventType));
          if (result.length !== expected.length) return false;
          return result.every((e, i) => e === expected[i]);
        }),
        { numRuns: 100 },
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Property 5: Clear resets to full list
// Validates: Requirements 5.2, 5.3
// ---------------------------------------------------------------------------

describe(
  "Feature: stream-timeline-filters, Property 5: Clear resets to full list",
  () => {
    it("after clearFilters, filteredEvents equals the full list", () => {
      fc.assert(
        fc.property(arbStreamEvents, arbNonEmptyFilterSet, (events, _activeFilters) => {
          const emptyFilters = clearFilters();
          const result = computeFilteredEvents(events, emptyFilters);
          return (
            result.length === events.length &&
            result.every((e, i) => e === events[i])
          );
        }),
        { numRuns: 100 },
      );
    });
  },
);
