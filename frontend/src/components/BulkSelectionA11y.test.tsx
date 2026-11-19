import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { StreamsTable } from "./StreamsTable";
import { Stream } from "../types/stream";

describe("Bulk selection keyboard and screen reader accessibility (SSB-2026-073)", () => {
  afterEach(() => {
    cleanup();
  });

  const mockActiveStream = (id: string): Stream => ({
    id,
    sender: "GSENDER_A11Y_TEST",
    recipient: "GRECIPIENT_A11Y_TEST",
    assetCode: "USDC",
    totalAmount: 1000,
    durationSeconds: 3600,
    startAt: Math.floor(Date.now() / 1000) - 1800,
    createdAt: Math.floor(Date.now() / 1000) - 1800,
    progress: {
      status: "active",
      ratePerSecond: 0.27,
      elapsedSeconds: 1800,
      vestedAmount: 500,
      remainingAmount: 500,
      percentComplete: 50,
    },
  });

  it("exposes proper aria-checked and indeterminate state for partial and full selection", () => {
    const streams = [mockActiveStream("stream-1"), mockActiveStream("stream-2")];

    render(
      <StreamsTable
        streams={streams}
        filters={{}}
        onFiltersChange={vi.fn()}
        onCancel={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onEditStartTime={vi.fn()}
      />
    );

    const selectAllCheckbox = screen.getByTestId("streams-table-select-all");
    expect(selectAllCheckbox).toHaveAttribute("aria-checked", "false");

    // Select first stream only
    const row1 = screen.getByRole("checkbox", { name: "Select stream stream-1" });
    expect(row1).toHaveAttribute("aria-checked", "false");
    fireEvent.click(row1);

    expect(row1).toHaveAttribute("aria-checked", "true");
    expect(selectAllCheckbox).toHaveAttribute("aria-checked", "mixed");

    // Live region status announcement
    const announcement = screen.getByTestId("bulk-selection-announcement");
    expect(announcement).toHaveTextContent("1 stream selected across view");

    // Select second stream to achieve full selection
    const row2 = screen.getByRole("checkbox", { name: "Select stream stream-2" });
    fireEvent.click(row2);

    expect(row2).toHaveAttribute("aria-checked", "true");
    expect(selectAllCheckbox).toHaveAttribute("aria-checked", "true");
    expect(announcement).toHaveTextContent("2 streams selected across view");
  });

  it("ensures bulk action bar has accessible region landmarks and live count announcements", () => {
    const streams = [mockActiveStream("s-1"), mockActiveStream("s-2")];

    render(
      <StreamsTable
        streams={streams}
        filters={{ status: "active" }}
        onFiltersChange={vi.fn()}
        onCancel={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onEditStartTime={vi.fn()}
      />
    );

    // Click select all
    const selectAll = screen.getByTestId("streams-table-select-all");
    fireEvent.click(selectAll);

    const bulkRegion = screen.getByTestId("bulk-action-bar");
    expect(bulkRegion).toHaveAttribute("role", "region");
    expect(bulkRegion).toHaveAttribute("aria-label", "Bulk actions");

    const liveCount = screen.getByTestId("bulk-selection-count");
    expect(liveCount).toHaveAttribute("role", "status");
    expect(liveCount).toHaveAttribute("aria-live", "polite");
    expect(liveCount).toHaveAttribute("aria-atomic", "true");

    const cancelBtn = screen.getByTestId("bulk-cancel-action-btn");
    expect(cancelBtn).toHaveAttribute("aria-label", "Cancel 2 Streams");
  });

  it("allows keyboard-only operation to clear and toggle selection", () => {
    const streams = [mockActiveStream("stream-a"), mockActiveStream("stream-b")];

    render(
      <StreamsTable
        streams={streams}
        filters={{}}
        onFiltersChange={vi.fn()}
        onCancel={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onEditStartTime={vi.fn()}
      />
    );

    // Select all via Ctrl+A keyboard shortcut
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(screen.getByTestId("bulk-selection-count")).toHaveTextContent("2 streams selected");

    // Clear via Escape key
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("bulk-action-bar")).not.toBeInTheDocument();
  });
});
