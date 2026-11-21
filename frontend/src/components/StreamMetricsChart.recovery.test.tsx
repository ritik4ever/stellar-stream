import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StreamMetricsChart } from "./StreamMetricsChart";
import { MetricsSnapshot } from "../hooks/useMetricsHistory";

vi.mock("../services/api", () => ({
  fetchStats: vi.fn().mockResolvedValue({
    total_streams: 10,
    active_streams: 4,
    completed_streams: 5,
    canceled_streams: 1,
    total_vested: 5000,
    avg_duration_seconds: 3600,
    unique_senders: 3,
    unique_recipients: 4,
  }),
}));

const mockSinglePoint: MetricsSnapshot[] = [
  {
    timestamp: 1700000000000,
    active: 5,
    completed: 2,
    vested: 1500,
  },
];

const mockMultiPoint: MetricsSnapshot[] = [
  {
    timestamp: 1700000000000,
    active: 5,
    completed: 2,
    vested: 1500,
  },
  {
    timestamp: 1700086400000,
    active: 8,
    completed: 4,
    vested: 3200,
  },
];

describe("StreamMetricsChart recovery and edge states (SSB-2026-082)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles empty data by rendering a clean empty state", () => {
    render(<StreamMetricsChart data={[]} />);
    expect(screen.getByText("No Chart Data Yet")).toBeInTheDocument();
    expect(
      screen.getByText("Metrics trends will appear here as data is collected over time.")
    ).toBeInTheDocument();
  });

  it("handles a single data point without calculation errors or division by zero", () => {
    render(<StreamMetricsChart data={mockSinglePoint} />);
    expect(screen.getByText(/Showing/i)).toBeInTheDocument();
  });

  it("displays stale data banner with actionable reconnect when isStale is true", () => {
    const onRetryMock = vi.fn();
    render(
      <StreamMetricsChart
        data={mockMultiPoint}
        isStale={true}
        onRetry={onRetryMock}
      />
    );

    const staleBanner = screen.getByTestId("metrics-stale-banner");
    expect(staleBanner).toBeInTheDocument();
    expect(
      screen.getByText(/Displaying cached metrics. Data may be stale./i)
    ).toBeInTheDocument();

    const reconnectBtn = screen.getByTestId("metrics-reconnect-button");
    expect(reconnectBtn).toBeInTheDocument();
    fireEvent.click(reconnectBtn);
    expect(onRetryMock).toHaveBeenCalledTimes(1);
  });

  it("provides an actionable retry button when error prop is provided", () => {
    const onRetryMock = vi.fn();
    const testError = new Error("Failed to stream telemetry metrics from server");

    render(
      <StreamMetricsChart
        data={[]}
        error={testError}
        onRetry={onRetryMock}
      />
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText("Failed to stream telemetry metrics from server")
    ).toBeInTheDocument();

    const retryBtn = screen.getByTestId("metrics-retry-button");
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(onRetryMock).toHaveBeenCalledTimes(1);
  });
});
