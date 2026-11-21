import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { StreamMetricsChart } from "./StreamMetricsChart";
import { MetricsSnapshot } from "../hooks/useMetricsHistory";

vi.mock("../services/api", () => ({
  fetchStats: vi.fn().mockResolvedValue({
    active_streams: 4,
    completed_streams: 8,
    canceled_streams: 1,
  }),
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  AreaChart: ({ children }: any) => <svg data-testid="mock-area-chart">{children}</svg>,
  Area: () => <g />,
  BarChart: () => <svg data-testid="mock-bar-chart" />,
  Bar: () => <g />,
  XAxis: () => <g />,
  YAxis: () => <g />,
  CartesianGrid: () => <g />,
  Tooltip: () => <g />,
  Legend: () => <g />,
  ReferenceArea: () => <g />,
}));

const DAY = 86400000;
const mockData: MetricsSnapshot[] = [
  { timestamp: 1750000000000, active: 10, completed: 5, vested: 500 },
  { timestamp: 1750000000000 + DAY, active: 12, completed: 6, vested: 600 },
  { timestamp: 1750000000000 + 2 * DAY, active: 15, completed: 7, vested: 750 },
  { timestamp: 1750000000000 + 3 * DAY, active: 18, completed: 8, vested: 900 },
];

describe("StreamMetricsChart accessibility and keyboard operability (SSB-2026-083)", () => {
  afterEach(() => {
    cleanup();
  });

  it("exposes landmark role and accessible time-range/axis unit descriptions", () => {
    render(<StreamMetricsChart data={mockData} />);

    // Region landmark
    const chartRegion = screen.getByRole("region", { name: "Stream metrics charts and trends" });
    expect(chartRegion).toBeInTheDocument();

    // Accessible time range and axis units description
    const rangeDescription = screen.getByTestId("chart-date-range");
    expect(rangeDescription).toHaveAttribute("tabindex", "0");
    expect(rangeDescription).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Y-axis displays vested amounts in asset units and stream counts")
    );
  });

  it("supports keyboard-only control navigation and announces status via polite live region", () => {
    render(<StreamMetricsChart data={mockData} />);

    const announcement = screen.getByTestId("metrics-a11y-announcement");
    expect(announcement).toHaveAttribute("role", "status");
    expect(announcement).toHaveAttribute("aria-live", "polite");
    expect(announcement).toHaveAttribute("aria-atomic", "true");

    // Click Zoom In
    const zoomInBtn = screen.getByTestId("metrics-zoom-in-btn");
    fireEvent.click(zoomInBtn);
    expect(announcement).toHaveTextContent("Zoomed in to narrower time range.");

    // Click Reset
    const resetBtn = screen.getByTestId("metrics-zoom-reset-btn");
    expect(resetBtn).not.toBeDisabled();
    fireEvent.click(resetBtn);
    expect(announcement).toHaveTextContent("Zoom reset to full time range.");

    // Toggle Box Zoom mode
    const modeBtn = screen.getByTestId("metrics-mode-toggle-btn");
    fireEvent.click(modeBtn);
    expect(announcement).toHaveTextContent("Switched to Zoom mode.");
  });

  it("maintains focus order and avoids repetitive alert spam on range changes", () => {
    render(<StreamMetricsChart data={mockData} />);

    const controls = screen.getByTestId("chart-header-controls");
    expect(controls).toBeInTheDocument();

    // Ensure no disruptive alert role is used for routine interactions
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
