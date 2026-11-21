import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import React from "react";
import { StatsPanel } from "./StatsPanel";

describe("StatsPanel recovery path (SSB-2026-087)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows useful error message on simulated failure, supports retry, and prevents duplicate actions", async () => {
    let resolveRetry: () => void = () => {};
    const onRetryMock = vi.fn().mockImplementation(() => {
      return new Promise<void>((resolve) => {
        resolveRetry = resolve;
      });
    });

    const statsError = new Error("RPC gateway timeout: unable to reach Soroban ledger");

    render(
      <StatsPanel
        error={statsError}
        onRetry={onRetryMock}
        total={0}
      />
    );

    // Useful error message in alert role
    const alertBox = screen.getByRole("alert");
    expect(alertBox).toHaveTextContent("RPC gateway timeout: unable to reach Soroban ledger");
    expect(screen.getByText("Unable to load live statistics")).toBeInTheDocument();

    // Retry button is available
    const retryBtn = screen.getByTestId("stats-retry-button");
    expect(retryBtn).toBeInTheDocument();
    expect(retryBtn).not.toBeDisabled();

    // First click triggers retry
    fireEvent.click(retryBtn);
    expect(onRetryMock).toHaveBeenCalledTimes(1);

    // In-flight retry button becomes disabled to prevent duplicate requests
    expect(retryBtn).toBeDisabled();
    expect(retryBtn).toHaveAttribute("aria-busy", "true");

    // Second click while in-flight does NOT send duplicate action
    fireEvent.click(retryBtn);
    expect(onRetryMock).toHaveBeenCalledTimes(1);

    // Resolve the in-flight retry
    resolveRetry();
    await waitFor(() => {
      expect(retryBtn).not.toBeDisabled();
    });
  });

  it("handles stats failing while streams still load with actionable retry and reconnect paths", () => {
    const onRetryMock = vi.fn();
    const onReconnectMock = vi.fn();
    const statsError = new Error("Aggregate indexer rate limit exceeded");

    render(
      <StatsPanel
        error={statsError}
        onRetry={onRetryMock}
        onReconnect={onReconnectMock}
        streamsLoading={true}
        total={5}
        active={2}
      />
    );

    // Background streams loading indicator
    expect(
      screen.getByText("Streams are still loading in the background…")
    ).toBeInTheDocument();
    expect(screen.getByTestId("boundary-stats-failed-streams-loading")).toHaveTextContent(
      "Streams loading in background"
    );

    // Specific actionable retry button
    const retryBtn = screen.getByTestId("stats-retry-button");
    expect(retryBtn).toHaveTextContent("Retry Loading Stats");
    fireEvent.click(retryBtn);
    expect(onRetryMock).toHaveBeenCalledTimes(1);

    // Dedicated reconnect button
    const reconnectBtn = screen.getByTestId("stats-reconnect-button");
    expect(reconnectBtn).toBeInTheDocument();
    expect(reconnectBtn).toHaveTextContent("Reconnect");
    fireEvent.click(reconnectBtn);
    expect(onReconnectMock).toHaveBeenCalledTimes(1);
  });

  it("preserves safe input (accountId) and safe zero totals across failure and retry", () => {
    const testAccountId = "GDY73KG7N5YF6XG6P44V5Z7Y4X5B3Q6V8N7M9L2K4J6H8G0F2D4S6A8W";
    const onRetryMock = vi.fn();
    const statsError = new Error("Network offline");

    const { rerender } = render(
      <StatsPanel
        accountId={testAccountId}
        error={statsError}
        onRetry={onRetryMock}
        total={0}
        active={0}
      />
    );

    // Safe input is preserved and rendered cleanly
    const accountEl = screen.getByTestId("stats-account-id");
    expect(accountEl).toBeInTheDocument();
    expect(accountEl).toHaveTextContent(testAccountId);

    // Totals remain safe numbers, avoiding NaN or crashes
    expect(screen.getByTestId("metric-total-value")).toHaveTextContent("0");
    expect(screen.getByTestId("metric-active-value")).toHaveTextContent("0");

    // After successful recovery (error cleared), safe input is still intact
    rerender(
      <StatsPanel
        accountId={testAccountId}
        error={null}
        total={12}
        active={8}
      />
    );

    expect(screen.getByTestId("stats-account-id")).toHaveTextContent(testAccountId);
    expect(screen.getByTestId("metric-total-value")).toHaveTextContent("12");
    expect(screen.getByTestId("metric-active-value")).toHaveTextContent("8");
  });
});
