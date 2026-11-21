import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatsPanel } from "./StatsPanel";

describe("StatsPanel mobile and narrow screen usability (SSB-2026-089)", () => {
  const LONG_ACCOUNT_ID =
    "GDY73KG7N5YF6XG6P44V5Z7Y4X5B3Q6V8N7M9L2K4J6H8G0F2D4S6A8W";

  it("renders long Stellar account IDs safely without horizontal clipping at 320px", () => {
    render(
      <div style={{ width: "320px", overflow: "hidden" }}>
        <StatsPanel
          accountId={LONG_ACCOUNT_ID}
          total={15}
          active={8}
          completed={7}
          vested={450000.5}
        />
      </div>
    );

    const accountEl = screen.getByTestId("stats-account-id");
    expect(accountEl).toBeInTheDocument();
    expect(accountEl).toHaveAttribute("title", LONG_ACCOUNT_ID);
    expect(accountEl.textContent).toBe(LONG_ACCOUNT_ID);
  });

  it("renders large vested amounts and totals without truncation on narrow viewports", () => {
    render(
      <div style={{ width: "320px" }}>
        <StatsPanel
          total={125000}
          active={95000}
          completed={30000}
          vested={987654321.25}
        />
      </div>
    );

    expect(screen.getByTestId("metric-total-value")).toHaveTextContent("125000");
    expect(screen.getByTestId("metric-active-value")).toHaveTextContent("95000");
    expect(screen.getByTestId("metric-completed-value")).toHaveTextContent("30000");
    expect(screen.getByTestId("metric-vested-value")).toHaveTextContent(
      "987,654,321.25"
    );
  });

  it("keeps action controls (retry button) fully accessible and operable at 320px width", () => {
    const onRetryMock = vi.fn();
    const error = new Error("Gateway connection lost");

    render(
      <div style={{ width: "320px" }}>
        <StatsPanel
          error={error}
          onRetry={onRetryMock}
          streamsLoading={false}
        />
      </div>
    );

    const retryBtn = screen.getByTestId("stats-retry-button");
    expect(retryBtn).toBeInTheDocument();
    expect(retryBtn).toHaveClass("stats-retry-btn");
    expect(retryBtn).not.toBeDisabled();
  });

  it("renders active, completed, and vested totals simultaneously at 768px tablet width", () => {
    render(
      <div style={{ width: "768px" }}>
        <StatsPanel
          total={50}
          active={20}
          completed={30}
          vested={15000}
        />
      </div>
    );

    const grid = screen.getByTestId("stats-metric-grid");
    expect(grid).toBeInTheDocument();
    expect(screen.getByTestId("metric-card-total")).toBeInTheDocument();
    expect(screen.getByTestId("metric-card-active")).toBeInTheDocument();
    expect(screen.getByTestId("metric-card-completed")).toBeInTheDocument();
    expect(screen.getByTestId("metric-card-vested")).toBeInTheDocument();
  });
});
