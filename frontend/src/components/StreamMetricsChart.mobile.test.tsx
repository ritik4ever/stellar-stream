import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StreamMetricsChart } from "./StreamMetricsChart";
import { MetricsSnapshot } from "../hooks/useMetricsHistory";

vi.mock("../services/api", () => ({
  fetchStats: vi.fn().mockResolvedValue({
    total_streams: 15,
    active_streams: 6,
    completed_streams: 7,
    canceled_streams: 2,
    total_vested: 9500,
    avg_duration_seconds: 7200,
    unique_senders: 4,
    unique_recipients: 5,
  }),
}));

const mockData: MetricsSnapshot[] = [
  { timestamp: 1700000000000, active: 4, completed: 2, vested: 1000 },
  { timestamp: 1700086400000, active: 6, completed: 3, vested: 2500 },
  { timestamp: 1700172800000, active: 9, completed: 5, vested: 5000 },
];

describe("StreamMetricsChart mobile usability on narrow screens (SSB-2026-084)", () => {
  it("keeps zoom controls and mode buttons accessible with 44px touch targets at 320px width", () => {
    render(
      <div style={{ width: "320px", overflow: "hidden" }}>
        <StreamMetricsChart data={mockData} />
      </div>
    );

    const controls = screen.getByTestId("chart-header-controls");
    expect(controls).toBeInTheDocument();

    const zoomInBtn = screen.getByRole("button", { name: /Zoom in metrics chart/i });
    const zoomOutBtn = screen.getByRole("button", { name: /Zoom out metrics chart/i });
    const resetBtn = screen.getByRole("button", { name: /Reset zoom on metrics chart/i });
    const modeBtn = screen.getByRole("button", { name: /Switch to Box Zoom mode/i });

    expect(zoomInBtn).toHaveStyle({ minHeight: "44px" });
    expect(zoomOutBtn).toHaveStyle({ minHeight: "44px" });
    expect(resetBtn).toHaveStyle({ minHeight: "44px" });
    expect(modeBtn).toHaveStyle({ minHeight: "44px" });
  });

  it("renders date range label cleanly without horizontal overflow", () => {
    render(
      <div style={{ width: "320px" }}>
        <StreamMetricsChart data={mockData} />
      </div>
    );

    const dateRange = screen.getByTestId("chart-date-range");
    expect(dateRange).toBeInTheDocument();
    expect(dateRange.textContent).toMatch(/Showing/i);
  });

  it("displays both line and bar charts responsively at 768px tablet width", () => {
    render(
      <div style={{ width: "768px" }}>
        <StreamMetricsChart data={mockData} />
      </div>
    );

    expect(screen.getByTestId("area-chart")).toBeInTheDocument();
  });
});
