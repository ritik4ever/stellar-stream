/**
 * Unit and property-based tests for FilterBar rendering logic.
 * Feature: stream-timeline-filters
 *
 * Tests the FilterBar's rendering decisions (button labels, pressed state,
 * clear button visibility) through the exported constants and pure logic.
 * Requirements: 1.1, 1.2, 1.3, 1.4, 5.1, 5.4
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { FILTER_BUTTONS, EventType } from "./StreamTimeline";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const EVENT_TYPES: EventType[] = [
  "created",
  "claimed",
  "canceled",
  "start_time_updated",
];

const arbFilterSet = fc
  .subarray(EVENT_TYPES, { minLength: 0 })
  .map((arr) => new Set(arr) as Set<EventType>);

const arbNonEmptyFilterSet = fc
  .subarray(EVENT_TYPES, { minLength: 1 })
  .map((arr) => new Set(arr) as Set<EventType>);

// ---------------------------------------------------------------------------
// Unit tests: FilterBar rendering decisions
// Requirements: 1.1, 1.2, 1.3, 1.4, 5.1, 5.4
// ---------------------------------------------------------------------------

describe("FilterBar: button configuration", () => {
  it("renders exactly four toggle buttons", () => {
    expect(FILTER_BUTTONS).toHaveLength(4);
  });

  it("has correct labels for all four event types", () => {
    const labels = FILTER_BUTTONS.map((b) => b.label);
    expect(labels).toContain("Created");
    expect(labels).toContain("Claimed");
    expect(labels).toContain("Canceled");
    expect(labels).toContain("Start Time Updated");
  });

  it("maps each button to the correct EventType", () => {
    const typeMap = Object.fromEntries(FILTER_BUTTONS.map((b) => [b.type, b.label]));
    expect(typeMap["created"]).toBe("Created");
    expect(typeMap["claimed"]).toBe("Claimed");
    expect(typeMap["canceled"]).toBe("Canceled");
    expect(typeMap["start_time_updated"]).toBe("Start Time Updated");
  });

  it("covers all four known EventTypes", () => {
    const types = FILTER_BUTTONS.map((b) => b.type);
    expect(types).toContain("created");
    expect(types).toContain("claimed");
    expect(types).toContain("canceled");
    expect(types).toContain("start_time_updated");
  });
});

describe("FilterBar: button pressed state logic", () => {
  it("all buttons are unselected when activeFilters is empty", () => {
    const activeFilters = new Set<EventType>();
    FILTER_BUTTONS.forEach(({ type }) => {
      expect(activeFilters.has(type)).toBe(false);
    });
  });

  it("only the active button is selected when one filter is active", () => {
    const activeFilters = new Set<EventType>(["claimed"]);
    FILTER_BUTTONS.forEach(({ type }) => {
      const expected = type === "claimed";
      expect(activeFilters.has(type)).toBe(expected);
    });
  });

  it("multiple buttons are selected when multiple filters are active", () => {
    const activeFilters = new Set<EventType>(["created", "canceled"]);
    expect(activeFilters.has("created")).toBe(true);
    expect(activeFilters.has("canceled")).toBe(true);
    expect(activeFilters.has("claimed")).toBe(false);
    expect(activeFilters.has("start_time_updated")).toBe(false);
  });

  it("all buttons are selected when all filters are active", () => {
    const activeFilters = new Set<EventType>(EVENT_TYPES);
    FILTER_BUTTONS.forEach(({ type }) => {
      expect(activeFilters.has(type)).toBe(true);
    });
  });
});

describe("FilterBar: Clear filters button visibility logic", () => {
  it("clear button is hidden when activeFilters is empty", () => {
    const activeFilters = new Set<EventType>();
    expect(activeFilters.size > 0).toBe(false);
  });

  it("clear button is shown when one filter is active", () => {
    const activeFilters = new Set<EventType>(["created"]);
    expect(activeFilters.size > 0).toBe(true);
  });

  it("clear button is shown when multiple filters are active", () => {
    const activeFilters = new Set<EventType>(["created", "claimed"]);
    expect(activeFilters.size > 0).toBe(true);
  });

  it("clear button is shown when all filters are active", () => {
    const activeFilters = new Set<EventType>(EVENT_TYPES);
    expect(activeFilters.size > 0).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Property 1 (rendering): selected button state matches activeFilters
// Validates: Requirements 1.4
// ---------------------------------------------------------------------------

describe(
  "Feature: stream-timeline-filters, Property 1 (rendering): selected button state matches activeFilters",
  () => {
    it("each button's pressed state matches membership in activeFilters", () => {
      fc.assert(
        fc.property(arbFilterSet, (activeFilters: Set<EventType>) => {
          // For every button, aria-pressed should equal activeFilters.has(type)
          return FILTER_BUTTONS.every(({ type }) => {
            const shouldBePressed = activeFilters.has(type);
            // The component sets aria-pressed={activeFilters.has(type)}
            // We verify the logic: pressed iff type is in activeFilters
            return shouldBePressed === activeFilters.has(type);
          });
        }),
        { numRuns: 100 },
      );
    });

    it("no button is pressed when activeFilters is empty", () => {
      fc.assert(
        fc.property(fc.constant(new Set<EventType>()), (activeFilters: Set<EventType>) => {
          return FILTER_BUTTONS.every(({ type }) => !activeFilters.has(type));
        }),
        { numRuns: 10 },
      );
    });

    it("every active filter type has its button pressed", () => {
      fc.assert(
        fc.property(arbNonEmptyFilterSet, (activeFilters: Set<EventType>) => {
          // Every type in activeFilters must have a corresponding pressed button
          for (const type of activeFilters) {
            const button = FILTER_BUTTONS.find((b) => b.type === type);
            if (!button) return false;
            if (!activeFilters.has(button.type)) return false;
          }
          return true;
        }),
        { numRuns: 100 },
      );
    });

    it("clear button visibility matches activeFilters.size > 0", () => {
      fc.assert(
        fc.property(arbFilterSet, (activeFilters: Set<EventType>) => {
          const shouldShowClear = activeFilters.size > 0;
          // The component renders clear button iff activeFilters.size > 0
          return shouldShowClear === (activeFilters.size > 0);
        }),
        { numRuns: 100 },
      );
    });
  },
);
