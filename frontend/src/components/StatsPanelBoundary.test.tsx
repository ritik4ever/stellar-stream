import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import React from "react";
import { StatsPanel } from "./StatsPanel";

describe("StatsPanel boundary state clarification (SSB-2026-086)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("All-zero totals boundary state", () => {
    it("renders explicit all-zero boundary badge and disables primary action to prevent misleading ready-to-act control", () => {
      const onActionMock = vi.fn();

      render(
        <StatsPanel
          total={0}
          active={0}
          completed={0}
          vested={0}
          onPrimaryAction={onActionMock}
        />
      );

      // Asserts explicit all-zero boundary banner and badge
      const boundaryBanner = screen.getByTestId("stats-all-zero-state");
      expect(boundaryBanner).toBeInTheDocument();
      expect(boundaryBanner).toHaveAttribute("data-boundary-case", "all-zero");

      const badge = screen.getByTestId("boundary-all-zero-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("All-zero activity");

      expect(
        screen.getByText(
          "No stream activity recorded yet. Totals will populate once streams are initialized."
        )
      ).toBeInTheDocument();

      // Asserts primary action is safely disabled and reflects actual state
      const actionBtn = screen.getByTestId("stats-primary-action-btn");
      expect(actionBtn).toBeInTheDocument();
      expect(actionBtn).toBeDisabled();
      expect(actionBtn).toHaveAttribute("aria-disabled", "true");
      expect(actionBtn).toHaveTextContent("No Streams Available");

      fireEvent.click(actionBtn);
      expect(onActionMock).not.toHaveBeenCalled();
    });
  });

  describe("Partially available totals boundary state", () => {
    it("renders explicit partial totals badge and enables action with state-aware label", () => {
      const onActionMock = vi.fn();

      // Partially available: total and active present, completed and vested are 0
      render(
        <StatsPanel
          total={4}
          active={4}
          completed={0}
          vested={0}
          onPrimaryAction={onActionMock}
        />
      );

      // Asserts partial totals badge
      const partialBanner = screen.getByTestId("stats-partial-state");
      expect(partialBanner).toBeInTheDocument();
      expect(partialBanner).toHaveAttribute(
        "data-boundary-case",
        "partial-totals"
      );

      const badge = screen.getByTestId("boundary-partial-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("Partially available totals");

      // Primary action reflects partial state and is operable
      const actionBtn = screen.getByTestId("stats-primary-action-btn");
      expect(actionBtn).toBeInTheDocument();
      expect(actionBtn).not.toBeDisabled();
      expect(actionBtn).toHaveTextContent("View Available Streams");

      fireEvent.click(actionBtn);
      expect(onActionMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("Stats failing while streams still load", () => {
    it("clarifies concurrent state with dedicated boundary badge, hint text, and state-aware retry action", () => {
      const onRetryMock = vi.fn();
      const statsError = new Error("Indexer aggregation RPC timeout");

      render(
        <StatsPanel
          error={statsError}
          onRetry={onRetryMock}
          streamsLoading={true}
          total={0}
        />
      );

      // Asserts error banner has boundary case attribute
      const errorBanner = screen.getByTestId("stats-error-banner");
      expect(errorBanner).toHaveAttribute(
        "data-boundary-case",
        "stats-failed-streams-loading"
      );

      // Asserts boundary badge specifically clarifies streams are loading in background
      const loadingBadge = screen.getByTestId(
        "boundary-stats-failed-streams-loading"
      );
      expect(loadingBadge).toBeInTheDocument();
      expect(loadingBadge).toHaveTextContent("Streams loading in background");

      // Asserts loading hint
      const hint = screen.getByTestId("stats-streams-loading-hint");
      expect(hint).toBeInTheDocument();
      expect(hint).toHaveTextContent(
        "Streams are still loading in the background…"
      );

      // Action button reflects specific state
      const retryBtn = screen.getByTestId("stats-retry-button");
      expect(retryBtn).toHaveTextContent("Retry Loading Stats");
      fireEvent.click(retryBtn);
      expect(onRetryMock).toHaveBeenCalledTimes(1);
    });

    it("renders stats offline badge when failure occurs and streams are not loading", () => {
      const statsError = new Error("Gateway error 503");

      render(
        <StatsPanel
          error={statsError}
          streamsLoading={false}
          total={0}
        />
      );

      const errorBadge = screen.getByTestId("boundary-stats-failed");
      expect(errorBadge).toBeInTheDocument();
      expect(errorBadge).toHaveTextContent("Stats offline");
      expect(
        screen.queryByTestId("stats-streams-loading-hint")
      ).not.toBeInTheDocument();
    });
  });

  describe("Fully available ready state", () => {
    it("renders ready state with active primary action when all metrics are populated", () => {
      const onActionMock = vi.fn();

      render(
        <StatsPanel
          total={10}
          active={6}
          completed={4}
          vested={5000}
          onPrimaryAction={onActionMock}
        />
      );

      expect(screen.queryByTestId("stats-all-zero-state")).not.toBeInTheDocument();
      expect(screen.queryByTestId("stats-partial-state")).not.toBeInTheDocument();
      expect(screen.queryByTestId("stats-error-banner")).not.toBeInTheDocument();

      const actionBtn = screen.getByTestId("stats-primary-action-btn");
      expect(actionBtn).toBeInTheDocument();
      expect(actionBtn).not.toBeDisabled();
      expect(actionBtn).toHaveTextContent("View All Streams");

      fireEvent.click(actionBtn);
      expect(onActionMock).toHaveBeenCalledTimes(1);
    });
  });
});
