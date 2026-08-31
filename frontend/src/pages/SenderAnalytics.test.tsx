/**
 * Tests for the sender analytics dashboard (issue #749).
 *
 * Covers:
 * - Wallet-not-connected state
 * - Empty state when the sender has no streams
 * - All four charts render for a sender with a single stream
 * - Monthly volume chart covers the last 12 months
 * - Aggregation across assets, statuses, and recipients
 * - Error state with retry
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../server";
import { SenderAnalytics, buildMonthlyBuckets } from "./SenderAnalytics";
import { Stream } from "../types/stream";

const SENDER = "GSENDER123";

// ---------------------------------------------------------------------------
// Chart dimension mock
//
// Recharts' ResponsiveContainer measures its parent via getBoundingClientRect
// and ResizeObserver. happy-dom reports 0x0, so charts never draw their
// content. Provide fixed dimensions so chart internals (axis ticks, legend)
// render and can be asserted in tests.
// ---------------------------------------------------------------------------

const CHART_RECT = {
  width: 400,
  height: 300,
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 400,
  bottom: 300,
  toJSON: () => ({}),
};

function mockChartDimensions() {
  // Give the chart container a real size, but let recharts' hidden
  // measurement span report a width proportional to its text so axis tick
  // overlap heuristics behave like a real browser.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const isMeasurementSpan = this.id === "recharts_measurement_span";
      const text = this.textContent ?? "";
      const width = isMeasurementSpan
        ? Math.max(10, text.length * 7)
        : CHART_RECT.width;
      return {
        ...CHART_RECT,
        width,
        right: width,
      } as DOMRect;
    },
  );

  class MockResizeObserver {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [{ target, contentRect: CHART_RECT } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStream(overrides: Partial<Stream> = {}): Stream {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    id: "1",
    sender: SENDER,
    recipient: "GRECIPIENT456",
    assetCode: "USDC",
    totalAmount: 1000,
    durationSeconds: 86400,
    startAt: nowSeconds - 86400,
    createdAt: nowSeconds - 86400,
    progress: {
      status: "active",
      ratePerSecond: 0.01157,
      elapsedSeconds: 43200,
      vestedAmount: 500,
      remainingAmount: 500,
      percentComplete: 50,
    },
    ...overrides,
  };
}

function setupSenderHandler(streams: Stream[], sender: string = SENDER) {
  server.use(
    http.get("/api/streams", ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get("sender") === sender) {
        return HttpResponse.json({
          data: streams,
          total: streams.length,
          page: 1,
          limit: 20,
        });
      }
      return HttpResponse.json({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
      });
    }),
  );
}

function setupErrorHandler() {
  server.use(
    http.get("/api/streams", () => {
      return HttpResponse.json({ error: "Server Error 500" }, { status: 500 });
    }),
  );
}

/** Expected labels for the trailing N months (mirrors the page's bucketing). */
function trailingMonthLabels(count: number, now: Date = new Date()): string[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1);
    return date.toLocaleString("en-US", { month: "short", year: "2-digit" });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SenderAnalytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChartDimensions();
  });

  it("shows wallet-not-connected state when no address is provided", () => {
    render(<SenderAnalytics senderAddress={null} />);
    expect(screen.getByText(/wallet not connected/i)).toBeInTheDocument();
  });

  it("shows empty state when the sender has no streams", async () => {
    setupSenderHandler([]);
    render(<SenderAnalytics senderAddress={SENDER} />);

    await waitFor(() => {
      expect(screen.getByText("No Stream Data")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/create your first stream to start seeing analytics/i),
    ).toBeInTheDocument();
  });

  it("renders all four chart sections for a sender with a single stream", async () => {
    setupSenderHandler([makeStream()]);
    render(<SenderAnalytics senderAddress={SENDER} />);

    await waitFor(() => {
      expect(screen.getByText("Total Streamed by Asset")).toBeInTheDocument();
    });

    expect(screen.getByText("Stream Status Breakdown")).toBeInTheDocument();
    expect(screen.getByText("Monthly Streaming Volume")).toBeInTheDocument();
    expect(screen.getByText("Top Recipients")).toBeInTheDocument();

    // Asset axis tick
    expect(screen.getByText("USDC")).toBeInTheDocument();
    // Status legend entry
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    // Top recipient (title holds the full address)
    expect(screen.getByTitle("GRECIPIENT456")).toBeInTheDocument();
  });

  it("renders the monthly volume chart section with its 12-month subtitle", async () => {
    setupSenderHandler([makeStream()]);
    render(<SenderAnalytics senderAddress={SENDER} />);

    await waitFor(() => {
      expect(screen.getByText("Monthly Streaming Volume")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/amount streamed per month.*last 12 months/i),
    ).toBeInTheDocument();
  });

  it("aggregates streams by asset, status, and recipient", async () => {
    const streams = [
      makeStream({
        id: "1",
        assetCode: "USDC",
        totalAmount: 1000,
        recipient: "GRECIPIENT456",
      }),
      makeStream({
        id: "2",
        assetCode: "XLM",
        totalAmount: 500,
        recipient: "GRECIPIENT456",
        progress: { ...makeStream().progress, status: "completed" },
      }),
      makeStream({
        id: "3",
        assetCode: "USDC",
        totalAmount: 250,
        recipient: "GRECIPIENT789",
        progress: { ...makeStream().progress, status: "paused" },
      }),
    ];
    setupSenderHandler(streams);
    render(<SenderAnalytics senderAddress={SENDER} />);

    await waitFor(() => {
      expect(screen.getByText("Total Streamed by Asset")).toBeInTheDocument();
    });

    // Both assets appear on the bar chart axis
    expect(screen.getByText("USDC")).toBeInTheDocument();
    expect(screen.getByText("XLM")).toBeInTheDocument();

    // Status legend entries
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Paused").length).toBeGreaterThan(0);

    // Both recipients are ranked
    expect(screen.getByTitle("GRECIPIENT456")).toBeInTheDocument();
    expect(screen.getByTitle("GRECIPIENT789")).toBeInTheDocument();

    // Total amount metric: 1000 + 500 + 250
    const totalCard = screen
      .getByText("Total Amount Streamed")
      .closest("article");
    expect(totalCard?.querySelector("strong")?.textContent).toContain("1,750");
  });

  // -------------------------------------------------------------------------
  // buildMonthlyBuckets (pure bucketing logic)
  // -------------------------------------------------------------------------

  it("builds exactly 12 monthly buckets covering the last 12 months", () => {
    const now = new Date(2026, 7, 15); // Aug 15, 2026
    const buckets = buildMonthlyBuckets([], 12, now);

    expect(buckets).toHaveLength(12);
    expect(buckets[0].label).toBe("Sep 25");
    expect(buckets[11].label).toBe("Aug 26");
    expect(buckets.map((b) => b.label)).toEqual(trailingMonthLabels(12, now));
    expect(buckets.every((b) => b.amount === 0)).toBe(true);
  });

  it("sums stream amounts into the month they were created", () => {
    const now = new Date(2026, 7, 15); // Aug 15, 2026
    const july = new Date(2026, 6, 10); // Jul 10, 2026
    const august = new Date(2026, 7, 2); // Aug 2, 2026
    const streams = [
      makeStream({ id: "1", totalAmount: 1000, createdAt: Math.floor(july.getTime() / 1000) }),
      makeStream({ id: "2", totalAmount: 500, createdAt: Math.floor(august.getTime() / 1000) }),
      makeStream({ id: "3", totalAmount: 250, createdAt: Math.floor(july.getTime() / 1000) }),
    ];

    const buckets = buildMonthlyBuckets(streams, 12, now);
    const julyBucket = buckets.find((b) => b.label === "Jul 26");
    const augustBucket = buckets.find((b) => b.label === "Aug 26");

    expect(julyBucket?.amount).toBe(1250);
    expect(augustBucket?.amount).toBe(500);
  });

  it("ignores streams created outside the 12-month window", () => {
    const now = new Date(2026, 7, 15); // Aug 15, 2026
    const twoYearsAgo = new Date(2024, 5, 1); // Jun 1, 2024
    const streams = [
      makeStream({
        id: "1",
        totalAmount: 9999,
        createdAt: Math.floor(twoYearsAgo.getTime() / 1000),
      }),
    ];

    const buckets = buildMonthlyBuckets(streams, 12, now);
    expect(buckets.every((b) => b.amount === 0)).toBe(true);
  });

  it("shows an error state with retry when the streams request fails", async () => {
    setupErrorHandler();
    render(<SenderAnalytics senderAddress={SENDER} />);

    await waitFor(() => {
      expect(screen.getByText("Analytics Load Failed")).toBeInTheDocument();
    });
    expect(screen.getByText(/500/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
