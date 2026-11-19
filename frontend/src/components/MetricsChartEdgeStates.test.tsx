import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { StreamMetricsChart } from "./StreamMetricsChart";
import { MetricsSnapshot } from "../hooks/useMetricsHistory";

vi.mock("../services/api", () => ({
  fetchStats: vi.fn().mockResolvedValue({
    active_streams: 3,
    completed_streams: 7,
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

const mockSinglePoint: MetricsSnapshot = {
  timestamp: 1750000000000,
  active: 4,
  completed: 2,
  vested: 250,
};

const mockMultiPoints: MetricsSnapshot[] = [
  mockSinglePoint,
  {
    timestamp: 1750000000000 + 86400000,
    active: 9,
    completed: 5,
    vested: 600,
  },
];

describe("Metrics chart edge and failure states (SSB-2026-085)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("Empty data edge and failure state", () => {
    it("renders explicit empty state boundary, message, and safe action without live testnet dependency", () => {
      const mockRetry = vi.fn();
      render(<StreamMetricsChart data={[]} onRetry={mockRetry} />);

      // Boundary assertions
      const emptyState = screen.getByTestId("metrics-empty-state");
      expect(emptyState).toBeInTheDocument();
      expect(emptyState).toHaveAttribute("data-boundary-case", "empty-data");

      const emptyBadge = screen.getByTestId("boundary-empty-badge");
      expect(emptyBadge).toBeInTheDocument();
      expect(emptyBadge).toHaveTextContent("Empty Data");

      expect(screen.getByText("No Chart Data Yet")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Metrics trends will appear here as data is collected over time."
        )
      ).toBeInTheDocument();

      // Safe retry action
      const checkBtn = screen.getByTestId("metrics-empty-retry-btn");
      expect(checkBtn).toBeInTheDocument();
      expect(checkBtn).toHaveTextContent("Check For Metrics");
      fireEvent.click(checkBtn);
      expect(mockRetry).toHaveBeenCalledTimes(1);

      // Misleading zoom/pan controls are omitted in empty state
      expect(screen.queryByTestId("chart-header-controls")).not.toBeInTheDocument();
    });
  });

  describe("Single data point edge state", () => {
    it("renders explicit single point badge, date notice, and safely disables zoom and mode interactions", () => {
      render(<StreamMetricsChart data={[mockSinglePoint]} />);

      // Notice and boundary badge
      const notice = screen.getByTestId("metrics-single-point-notice");
      expect(notice).toBeInTheDocument();
      expect(screen.getByTestId("boundary-single-point-badge")).toHaveTextContent(
        "Single Point"
      );
      expect(notice).toHaveTextContent("Single Data Point:");

      // Safe control behavior: disabled zoom controls prevent division by zero or misleading state
      const zoomInBtn = screen.getByTestId("metrics-zoom-in-btn");
      const zoomOutBtn = screen.getByTestId("metrics-zoom-out-btn");
      const modeBtn = screen.getByTestId("metrics-mode-toggle-btn");

      expect(zoomInBtn).toBeDisabled();
      expect(zoomOutBtn).toBeDisabled();
      expect(modeBtn).toBeDisabled();
      expect(zoomInBtn).toHaveAttribute(
        "title",
        "Zoom requires multiple data points"
      );
      expect(zoomOutBtn).toHaveAttribute(
        "title",
        "Zoom requires multiple data points"
      );
      expect(modeBtn).toHaveAttribute(
        "title",
        "Interaction modes require multiple data points"
      );
    });
  });

  describe("Metrics request returning stale data failure state", () => {
    it("renders explicit stale banner, badge, and actionable sync recovery path", () => {
      const mockSync = vi.fn();
      render(
        <StreamMetricsChart
          data={mockMultiPoints}
          isStale={true}
          onRetry={mockSync}
        />
      );

      // Stale banner and badge
      const staleBanner = screen.getByTestId("metrics-stale-banner");
      expect(staleBanner).toBeInTheDocument();
      expect(screen.getByTestId("boundary-stale-badge")).toHaveTextContent(
        "Stale Data"
      );
      expect(
        screen.getByText("Displaying cached metrics. Data may be stale.")
      ).toBeInTheDocument();

      // Actionable recovery path
      const syncBtn = screen.getByTestId("metrics-reconnect-button");
      expect(syncBtn).toBeInTheDocument();
      expect(syncBtn).toHaveTextContent("Sync Latest");
      fireEvent.click(syncBtn);
      expect(mockSync).toHaveBeenCalledTimes(1);

      // Cached data chart remains functional
      expect(screen.getByTestId("metrics-zoom-in-btn")).not.toBeDisabled();
      expect(screen.getByTestId("metrics-zoom-out-btn")).not.toBeDisabled();
    });
  });

  describe("Metrics request error failure state", () => {
    it("renders accessible error state and actionable retry trigger", () => {
      const mockRetry = vi.fn();
      render(
        <StreamMetricsChart
          data={[]}
          error="Failed to load metrics from indexer"
          onRetry={mockRetry}
        />
      );

      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent("Failed to load metrics from indexer");

      const retryBtn = screen.getByTestId("metrics-retry-button");
      expect(retryBtn).toBeInTheDocument();
      fireEvent.click(retryBtn);
      expect(mockRetry).toHaveBeenCalledTimes(1);
    });
  });
});
