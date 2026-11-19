import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { StreamsTable } from "./StreamsTable";
import { Stream } from "../types/stream";

describe("Bulk selection boundary state in filtered views (SSB-2026-071)", () => {
  afterEach(() => {
    cleanup();
  });

  const mockActiveStream = (id: string): Stream => ({
    id,
    sender: "GSENDER_BULK_BOUNDARY",
    recipient: "GRECIPIENT_BULK_BOUNDARY",
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

  const mockCompletedStream = (id: string): Stream => ({
    ...mockActiveStream(id),
    progress: {
      status: "completed",
      ratePerSecond: 0,
      elapsedSeconds: 3600,
      vestedAmount: 1000,
      remainingAmount: 0,
      percentComplete: 100,
    },
  });

  it("clarifies filtered scope when select-all is triggered across active filters", () => {
    const streams = [mockActiveStream("stream-1"), mockActiveStream("stream-2")];

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

    const selectAllCheckbox = screen.getByTestId("streams-table-select-all");
    expect(selectAllCheckbox).toBeInTheDocument();
    expect(selectAllCheckbox).not.toBeDisabled();

    // Trigger select all
    fireEvent.click(selectAllCheckbox);

    // Asserts bulk action bar rendered with explicit Filtered badge
    const countDisplay = screen.getByTestId("bulk-selection-count");
    expect(countDisplay).toHaveTextContent("2 streams selected");

    const filteredBadge = screen.getByTestId("bulk-filtered-badge");
    expect(filteredBadge).toBeInTheDocument();
    expect(filteredBadge).toHaveTextContent("Filtered");

    const cancelActionBtn = screen.getByTestId("bulk-cancel-action-btn");
    expect(cancelActionBtn).toHaveTextContent("Cancel 2 Streams");
    expect(cancelActionBtn).not.toBeDisabled();
  });

  it("disables select-all and avoids misleading ready-to-act control when filtered page has zero actionable streams", () => {
    // Only completed streams in filtered view
    const completedStreams = [
      mockCompletedStream("stream-c1"),
      mockCompletedStream("stream-c2"),
    ];

    render(
      <StreamsTable
        streams={completedStreams}
        filters={{ status: "completed" }}
        onFiltersChange={vi.fn()}
        onCancel={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onEditStartTime={vi.fn()}
      />
    );

    const selectAll = screen.getByTestId("streams-table-select-all");
    expect(selectAll).toBeDisabled();
    expect(selectAll).toHaveAttribute("aria-label", "No selectable streams on this page");

    // No ready-to-act bulk action bar is shown
    expect(screen.queryByTestId("bulk-action-bar")).not.toBeInTheDocument();
  });

  it("updates actionable counts dynamically when user selects individual streams", () => {
    const streams = [mockActiveStream("s-1"), mockActiveStream("s-2"), mockActiveStream("s-3")];

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

    // Initially no bulk action bar
    expect(screen.queryByTestId("bulk-action-bar")).not.toBeInTheDocument();

    // Select first stream
    const rowCheckbox = screen.getByRole("checkbox", { name: "Select stream s-1" });
    fireEvent.click(rowCheckbox);

    expect(screen.getByTestId("bulk-selection-count")).toHaveTextContent("1 stream selected");
    expect(screen.getByTestId("bulk-cancel-action-btn")).toHaveTextContent("Cancel 1 Stream");

    // Select second stream
    const row2Checkbox = screen.getByRole("checkbox", { name: "Select stream s-2" });
    fireEvent.click(row2Checkbox);

    expect(screen.getByTestId("bulk-selection-count")).toHaveTextContent("2 streams selected");
    expect(screen.getByTestId("bulk-cancel-action-btn")).toHaveTextContent("Cancel 2 Streams");
  });
});
