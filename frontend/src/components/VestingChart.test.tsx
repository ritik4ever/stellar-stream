import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  VestingChart,
  vestedAt,
  buildVestingData,
} from "./VestingChart";
import type { Stream } from "../types/stream";

// Mock recharts so tests don't depend on canvas/SVG rendering
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ data, children }: any) => (
    <svg data-testid="line-chart" data-points={data?.length}>{children}</svg>
  ),
  Line: ({ dataKey, strokeDasharray, name }: any) => (
    <g data-testid={`line-${dataKey}`} data-dash={strokeDasharray || ""}>
      {name}
    </g>
  ),
  XAxis: ({ dataKey }: any) => <g data-testid="x-axis">{dataKey}</g>,
  YAxis: () => <g data-testid="y-axis" />,
  CartesianGrid: () => <g data-testid="cartesian-grid" />,
  Tooltip: () => <g data-testid="tooltip" />,
  Legend: () => <g data-testid="legend" />,
  ReferenceLine: ({ x }: any) => <g data-testid="reference-line" data-x={x} />,
}));

const DAY = 86400;
const START = 1_700_000_000;

function makeStream(overrides: Partial<Stream> = {}): Stream {
  const totalAmount = 1000;
  const durationSeconds = DAY;
  const startAt = START;
  const now = startAt + DAY / 4; // 25% elapsed
  return {
    id: "stream-1",
    sender: "GAUPLKB5ZEWHHY5EXTG6CMI5GDTB6K3JQL5A7E3ZVQ6JQ3JKRF3TCRKC",
    recipient: "GAVMF7NH6GZ4O6RJFHQB4SIKOL6KCYWK5JYSH4W7AWRMXXTZJZJ4JKLM",
    assetCode: "USDC",
    totalAmount,
    durationSeconds,
    startAt,
    createdAt: startAt - DAY,
    cliffSeconds: DAY / 2,
    pausedDuration: 0,
    progress: {
      status: "active",
      ratePerSecond: totalAmount / durationSeconds,
      elapsedSeconds: DAY / 4,
      vestedAmount: totalAmount / 4,
      remainingAmount: totalAmount * (3 / 4),
      percentComplete: 25,
    },
    ...overrides,
  };
}

describe("VestingChart", () => {
  describe("vestedAt (AC1: past line matches actual vested amounts)", () => {
    const stream = makeStream();

    it("is 0 before the stream starts", () => {
      expect(vestedAt(stream, stream.startAt - 100)).toBe(0);
    });

    it("vests linearly with time between start and end", () => {
      const quarter = vestedAt(stream, stream.startAt + DAY / 4);
      expect(quarter).toBe(250);
      const half = vestedAt(stream, stream.startAt + DAY / 2);
      expect(half).toBe(500);
    });

    it("caps at the total amount after the stream ends", () => {
      expect(vestedAt(stream, stream.startAt + DAY)).toBe(1000);
      expect(vestedAt(stream, stream.startAt + DAY * 2)).toBe(1000);
    });

    it("accounts for paused duration", () => {
      const paused = makeStream({ pausedDuration: DAY / 2 });
      const halfElapsed = vestedAt(paused, paused.startAt + (DAY / 2) * 2);
      expect(halfElapsed).toBe(500);
    });

    it("pauses the vesting clock at pausedAt until resumed", () => {
      const duringPause = makeStream({ pausedAt: START + DAY / 4, pausedDuration: DAY / 8 });
      expect(vestedAt(duringPause, START + DAY / 4)).toBe(125);
      expect(vestedAt(duringPause, START + DAY / 2)).toBe(125);
      const resumed = makeStream({ pausedDuration: DAY / 8 });
      expect(vestedAt(resumed, START + DAY / 2)).toBe(375);
    });
  });

  describe("buildVestingData (AC1 + AC2)", () => {
    it("anchors the final past point on the reported vested amount", () => {
      const stream = makeStream();
      const data = buildVestingData(stream, stream.startAt + DAY / 4);
      const pastPoints = data.filter((p) => p.past != null);
      expect(pastPoints[pastPoints.length - 1].past).toBe(stream.progress.vestedAmount);
    });

    it("produces past plus future series through the current point", () => {
      const stream = makeStream();
      const now = stream.startAt + DAY / 4;
      const data = buildVestingData(stream, now);
      const hasPast = data.some((p) => p.past != null);
      const hasFuture = data.some((p) => p.future != null);
      expect(hasPast).toBe(true);
      expect(hasFuture).toBe(true);
      const atNow = data.find((p) => p.t === now);
      expect(atNow).toBeDefined();
      expect(atNow.past).toBe(stream.progress.vestedAmount);
      expect(atNow.future).toBe(stream.progress.vestedAmount);
    });

    it("starts the future projection at the current point (AC2)", () => {
      const stream = makeStream();
      const now = stream.startAt + DAY / 4;
      const data = buildVestingData(stream, now);
      const futurePoints = data.filter((p) => p.future != null);
      expect(futurePoints[0].t).toBe(now);
      expect(futurePoints[0].future).toBe(stream.progress.vestedAmount);
    });

    it("has no future line once the stream is canceled", () => {
      const base = makeStream();
      const stream = makeStream({ canceledAt: base.startAt + DAY / 4 });
      const data = buildVestingData(stream, stream.startAt + DAY / 4);
      expect(data.every((p) => p.future == null)).toBe(true);
    });

    it("marks future points until the stream end", () => {
      const stream = makeStream();
      const data = buildVestingData(stream, stream.startAt + DAY / 4);
      const futurePoints = data.filter((p) => p.future != null);
      expect(futurePoints[futurePoints.length - 1].future).toBe(1000);
    });
  });

  describe("component rendering", () => {
    it("renders past (solid) and future (dashed) lines", () => {
      const stream = makeStream();
      render(<VestingChart stream={stream} now={stream.startAt + DAY / 4} />);
      expect(screen.getByTestId("line-past")).toBeInTheDocument();
      expect(screen.getByTestId("line-future")).toBeInTheDocument();
    });

    it("draws the future line with a dashed stroke", () => {
      const stream = makeStream();
      render(<VestingChart stream={stream} now={stream.startAt + DAY / 4} />);
      expect(screen.getByTestId("line-past").getAttribute("data-dash")).toBe("");
      expect(screen.getByTestId("line-future").getAttribute("data-dash")).toBe("6 3");
    });

    it("marks the cliff on its correct date (AC3)", () => {
      const stream = makeStream();
      render(<VestingChart stream={stream} now={stream.startAt + DAY / 4} />);
      const cliff = screen.getByTestId("reference-line");
      const expectedX = new Date((stream.startAt + stream.cliffSeconds!) * 1000).toLocaleDateString(
        [],
        { month: "short", day: "numeric" },
      );
      expect(cliff.getAttribute("data-x")).toBe(expectedX);
    });

    it("renders no cliff marker when there is no cliff", () => {
      const stream = makeStream({ cliffSeconds: undefined });
      render(<VestingChart stream={stream} now={stream.startAt + DAY / 4} />);
      expect(screen.queryByTestId("reference-line")).not.toBeInTheDocument();
    });

    it("renders no cliff marker when the cliff equals the duration", () => {
      const stream = makeStream({ cliffSeconds: DAY });
      render(<VestingChart stream={stream} now={stream.startAt + DAY / 4} />);
      expect(screen.queryByTestId("reference-line")).not.toBeInTheDocument();
    });

    it("renders no future line for a completed stream", () => {
      const stream = makeStream();
      render(<VestingChart stream={stream} now={stream.startAt + DAY * 2} />);
      expect(screen.getByTestId("line-past")).toBeInTheDocument();
      expect(screen.queryByTestId("line-future")).not.toBeInTheDocument();
    });

    it("renders a flat past line for a scheduled stream", () => {
      const stream = makeStream();
      render(<VestingChart stream={stream} now={stream.startAt - DAY} />);
      expect(screen.getByTestId("line-past")).toBeInTheDocument();
      expect(screen.getByTestId("line-future")).toBeInTheDocument();
    });

    it("uses date as the x-axis dataKey", () => {
      const stream = makeStream();
      render(<VestingChart stream={stream} now={stream.startAt + DAY / 4} />);
      expect(screen.getByTestId("x-axis").textContent).toBe("label");
    });

    it("wraps the chart in a ResponsiveContainer", () => {
      const stream = makeStream();
      render(<VestingChart stream={stream} now={stream.startAt + DAY / 4} />);
      expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    });
  });

  describe("time range selector", () => {
    it("defaults to the full range", () => {
      const stream = makeStream();
      render(<VestingChart stream={stream} now={stream.startAt + DAY / 4} />);
      expect(Number(screen.getByTestId("line-chart").getAttribute("data-points"))).toBeGreaterThan(1);
    });

    it("filters points when a smaller range is selected", () => {
      const stream = makeStream();
      render(<VestingChart stream={stream} now={stream.startAt + DAY / 4} />);
      const fullPoints = Number(screen.getByTestId("line-chart").getAttribute("data-points"));
      fireEvent.click(screen.getByRole("button", { name: "25%" }));
      const quarterPoints = Number(screen.getByTestId("line-chart").getAttribute("data-points"));
      expect(quarterPoints).toBeLessThan(fullPoints);
    });

    it("restores the full range when All is selected", () => {
      const stream = makeStream();
      render(<VestingChart stream={stream} now={stream.startAt + DAY / 4} />);
      const fullPoints = Number(screen.getByTestId("line-chart").getAttribute("data-points"));
      fireEvent.click(screen.getByRole("button", { name: "25%" }));
      const quarterPoints = Number(screen.getByTestId("line-chart").getAttribute("data-points"));
      fireEvent.click(screen.getByRole("button", { name: "All" }));
      const restored = Number(screen.getByTestId("line-chart").getAttribute("data-points"));
      expect(quarterPoints).toBeLessThan(fullPoints);
      expect(restored).toBe(fullPoints);
    });
  });

  describe("states", () => {
    it("renders the empty state when no stream is provided", () => {
      render(<VestingChart stream={null} now={1_700_000_000} />);
      expect(screen.getByText(/No Chart Data Yet/i)).toBeInTheDocument();
      expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
    });

    it("renders the loading state when loading=true", () => {
      render(<VestingChart stream={null} loading={true} />);
      expect(screen.getByText(/Loading Chart Data/i)).toBeInTheDocument();
      expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
    });

    it("renders the error state when error is provided", () => {
      render(<VestingChart stream={null} error={new Error("Network timeout")} />);
      expect(screen.getByText(/Failed to Load Chart/i)).toBeInTheDocument();
      expect(screen.getByText(/Network timeout/i)).toBeInTheDocument();
      expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
    });
  });
});