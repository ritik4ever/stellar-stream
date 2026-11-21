import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { StreamMetricsChart } from "./StreamMetricsChart";
import { MetricsSnapshot } from "../hooks/useMetricsHistory";

vi.mock("../services/api", () => ({
  fetchStats: vi.fn().mockResolvedValue({
    active_streams: 5,
    completed_streams: 10,
    canceled_streams: 2,
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

const mockSinglePoint: MetricsSnapshot = {
  timestamp: 1750000000000,
  active: 8,
  completed: 4,
  vested: 500,
};

const mockMultiPoints: MetricsSnapshot[] = [
  mockSinglePoint,
  {
    timestamp: 1750000000000 + 86400000,
    active: 12,
    completed: 6,
    vested: 750,
  },
];

describe("StreamMetricsChart boundary states (SSB-2026-081)", () => {
  afterEach(() => {
    cleanup();
  });

  describe("Empty data boundary", () => {
    it("renders explicit empty state badge and action, avoiding misleading chart controls", () => {
      const mockRetry = vi.fn();
      render(<StreamMetricsChart data={[]} onRetry={mockRetry} />);

      expect(screen.getByTestId("metrics-empty-state")).toBeInTheDocument();
      expect(screen.getByTestId("boundary-empty-badge")).toHaveTextContent("Empty Data");
      expect(screen.getByText("No Chart Data Yet")).toBeInTheDocument();

      // Actionable retry control
      const checkBtn = screen.getByTestId("metrics-empty-retry-btn");
      expect(checkBtn).toHaveTextContent("Check For Metrics");
      fireEvent.click(checkBtn);
      expect(mockRetry).toHaveBeenCalledTimes(1);

      // Misleading zoom/pan controls are not rendered
      expect(screen.queryByTestId("chart-header-controls")).not.toBeInTheDocument();
    });
  });

  describe("Single data point boundary", () => {
    it("renders explicit single point badge and disables zoom controls to prevent misleading interaction", () => {
      render(<StreamMetricsChart data={[mockSinglePoint]} />);

      // Single point notice and badge
      expect(screen.getByTestId("metrics-single-point-notice")).toBeInTheDocument();
      expect(screen.getByTestId("boundary-single-point-badge")).toHaveTextContent("Single Point");
      expect(screen.getByText(/Single Data Point:/i)).toBeInTheDocument();

      // Controls are rendered but safely disabled
      const zoomInBtn = screen.getByTestId("metrics-zoom-in-btn");
      const zoomOutBtn = screen.getByTestId("metrics-zoom-out-btn");
      const modeToggleBtn = screen.getByTestId("metrics-mode-toggle-btn");

      expect(zoomInBtn).toBeDisabled();
      expect(zoomOutBtn).toBeDisabled();
      expect(modeToggleBtn).toBeDisabled();
      expect(zoomInBtn).toHaveAttribute(
        "title",
        "Zoom requires multiple data points"
      );
    });
  });

  describe("Stale data boundary", () => {
    it("renders explicit stale badge and primary sync action", () => {
      const mockSync = vi.fn();
      render(<StreamMetricsChart data={mockMultiPoints} isStale={true} onRetry={mockSync} />);

      expect(screen.getByTestId("metrics-stale-banner")).toBeInTheDocument();
      expect(screen.getByTestId("boundary-stale-badge")).toHaveTextContent("Stale Data");

      const syncBtn = screen.getByTestId("metrics-reconnect-button");
      expect(syncBtn).toHaveTextContent("Sync Latest");
      fireEvent.click(syncBtn);
      expect(mockSync).toHaveBeenCalledTimes(1);

      // Controls for multi-point data remain enabled
      expect(screen.getByTestId("metrics-zoom-in-btn")).not.toBeDisabled();
      expect(screen.getByTestId("metrics-zoom-out-btn")).not.toBeDisabled();
    });
  });
});
