import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StatsPanel } from "./StatsPanel";

describe("StatsPanel edge and failure states (SSB-2026-090)", () => {
  it("renders all-zero totals cleanly without crashing or displaying NaN", () => {
    render(
      <StatsPanel
        total={0}
        active={0}
        completed={0}
        vested={0}
      />
    );

    expect(screen.getByTestId("stats-panel")).toBeInTheDocument();
    expect(screen.getByTestId("metric-total-value")).toHaveTextContent("0");
    expect(screen.getByTestId("metric-active-value")).toHaveTextContent("0");
    expect(screen.getByTestId("metric-completed-value")).toHaveTextContent("0");
    expect(screen.getByTestId("metric-vested-value")).toHaveTextContent("0.00");
  });

  it("handles partially available totals correctly when some metrics are zero or missing", () => {
    // Partially available: total and active available, completed is zero, vested is 1250.75
    render(
      <StatsPanel
        total={3}
        active={3}
        completed={0}
        vested={1250.75}
      />
    );

    expect(screen.getByTestId("metric-total-value")).toHaveTextContent("3");
    expect(screen.getByTestId("metric-active-value")).toHaveTextContent("3");
    expect(screen.getByTestId("metric-completed-value")).toHaveTextContent("0");
    expect(screen.getByTestId("metric-vested-value")).toHaveTextContent("1,250.75");
  });

  it("normalizes non-finite or negative numbers safely to zero", () => {
    render(
      <StatsPanel
        total={-5}
        active={Number.NaN}
        completed={-1}
        vested={-100}
      />
    );

    expect(screen.getByTestId("metric-total-value")).toHaveTextContent("0");
    expect(screen.getByTestId("metric-active-value")).toHaveTextContent("0");
    expect(screen.getByTestId("metric-completed-value")).toHaveTextContent("0");
    expect(screen.getByTestId("metric-vested-value")).toHaveTextContent("0.00");
  });

  it("displays failure state with actionable retry when stats API fails while streams still load", () => {
    const onRetryMock = vi.fn();
    const statsError = new Error("Failed to fetch aggregate metrics from RPC gateway");

    render(
      <StatsPanel
        error={statsError}
        onRetry={onRetryMock}
        streamsLoading={true}
        total={0}
      />
    );

    // Verify error banner is rendered with accessible role
    const errorBanner = screen.getByRole("alert");
    expect(errorBanner).toBeInTheDocument();
    expect(screen.getByText("Unable to load live statistics")).toBeInTheDocument();
    expect(
      screen.getByText("Failed to fetch aggregate metrics from RPC gateway")
    ).toBeInTheDocument();

    // Verify background streams loading hint is displayed
    expect(
      screen.getByText("Streams are still loading in the background…")
    ).toBeInTheDocument();

    // Verify retry button is clickable and triggers retry callback
    const retryBtn = screen.getByTestId("stats-retry-button");
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(onRetryMock).toHaveBeenCalledTimes(1);
  });

  it("disables retry button during loading state", () => {
    const onRetryMock = vi.fn();
    const statsError = new Error("Network timeout");

    render(
      <StatsPanel
        error={statsError}
        loading={true}
        onRetry={onRetryMock}
      />
    );

    const retryBtn = screen.getByTestId("stats-retry-button");
    expect(retryBtn).toBeDisabled();
    expect(retryBtn).toHaveTextContent("Retrying…");
  });
});
