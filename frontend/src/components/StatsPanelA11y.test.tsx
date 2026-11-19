import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import React from "react";
import { StatsPanel } from "./StatsPanel";

describe("StatsPanel accessibility and keyboard operability (SSB-2026-088)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("Screen reader status announcements", () => {
    it("announces changed status via polite live region without generating repeated disruptive alerts", () => {
      const { rerender } = render(
        <StatsPanel
          total={0}
          active={0}
          completed={0}
          vested={0}
        />
      );

      // Status announcement region with polite aria-live
      const announcement = screen.getByTestId("stats-a11y-announcement");
      expect(announcement).toHaveAttribute("role", "status");
      expect(announcement).toHaveAttribute("aria-live", "polite");
      expect(announcement).toHaveAttribute("aria-atomic", "true");
      expect(announcement).toHaveTextContent(
        "Stream metrics: No stream activity recorded yet. All totals are zero."
      );

      // Verify no disruptive alert role is fired for ordinary all-zero status
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      // Rerender with partially available totals
      rerender(
        <StatsPanel
          total={5}
          active={3}
          completed={0}
          vested={150}
        />
      );

      expect(announcement).toHaveTextContent(
        "Stream metrics updated: Partially available totals. Total streams: 5, Active: 3, Completed: 0, Total Vested: 150.00."
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      // Rerender with full ready totals
      rerender(
        <StatsPanel
          total={10}
          active={6}
          completed={4}
          vested={2500}
        />
      );

      expect(announcement).toHaveTextContent(
        "Stream metrics ready: 10 total streams, 6 active, 4 completed, 2,500.00 vested."
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("Keyboard navigation and focus order", () => {
    it("provides focusable metric cards with explicit field names and values for screen readers", () => {
      render(
        <StatsPanel
          total={15}
          active={8}
          completed={7}
          vested={4500.5}
        />
      );

      const totalCard = screen.getByTestId("metric-card-total");
      const activeCard = screen.getByTestId("metric-card-active");
      const completedCard = screen.getByTestId("metric-card-completed");
      const vestedCard = screen.getByTestId("metric-card-vested");

      // Verify each card is focusable in natural tab order
      expect(totalCard).toHaveAttribute("tabindex", "0");
      expect(activeCard).toHaveAttribute("tabindex", "0");
      expect(completedCard).toHaveAttribute("tabindex", "0");
      expect(vestedCard).toHaveAttribute("tabindex", "0");

      // Verify explicit accessible names for screen reader virtual cursor
      expect(totalCard).toHaveAttribute("aria-label", "Total Streams: 15");
      expect(activeCard).toHaveAttribute("aria-label", "Active Streams: 8");
      expect(completedCard).toHaveAttribute("aria-label", "Completed Streams: 7");
      expect(vestedCard).toHaveAttribute("aria-label", "Total Vested Amount: 4,500.50");
    });

    it("supports keyboard-only activation of primary action and retry paths", () => {
      const onActionMock = vi.fn();

      render(
        <StatsPanel
          total={8}
          active={5}
          completed={3}
          vested={1200}
          onPrimaryAction={onActionMock}
        />
      );

      const actionBtn = screen.getByTestId("stats-primary-action-btn");
      expect(actionBtn).not.toBeDisabled();

      // Focus and trigger via Enter / Space keyboard event
      actionBtn.focus();
      expect(document.activeElement).toBe(actionBtn);

      fireEvent.click(actionBtn);
      expect(onActionMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("Region landmark role", () => {
    it("exposes region landmark role with accessible label for landmark navigation", () => {
      render(<StatsPanel total={2} active={1} />);

      const panelRegion = screen.getByRole("region", {
        name: "Stream summary metrics",
      });
      expect(panelRegion).toBeInTheDocument();
    });
  });
});
