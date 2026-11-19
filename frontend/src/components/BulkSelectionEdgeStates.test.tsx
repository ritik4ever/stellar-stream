import React from "react";
import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { StreamsTable } from "./StreamsTable";
import { SenderDashboard } from "./SenderDashboard";
import { Stream } from "../types/stream";

const SENDER = "GSENDER_BULK_EDGE_TEST";

const mockActiveStream = (id: string, assetCode = "USDC"): Stream => ({
  id,
  sender: SENDER,
  recipient: "GRECIPIENT_BULK_EDGE_TEST",
  assetCode,
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

let failStreamId: string | null = "stream-edge-2";
let executedCancelIds: string[] = [];

const server = setupServer(
  http.get("/api/streams", () => HttpResponse.json({ data: [] })),
  http.get("/api/streams/sender/:address", () =>
    HttpResponse.json({
      data: [
        mockActiveStream("stream-edge-1"),
        mockActiveStream("stream-edge-2"),
        mockActiveStream("stream-edge-3"),
      ],
    })
  ),
  http.get("/api/streams/sender/:address/events", () => HttpResponse.json({ data: [] })),
  http.get("/api/streams/:id/history", () => HttpResponse.json({ data: [] })),
  http.post("/api/streams/:id/cancel", ({ params }) => {
    const id = String(params.id);
    executedCancelIds.push(id);
    if (id === failStreamId) {
      return HttpResponse.json(
        { message: "Simulated Horizon timeout on batch item" },
        { status: 504 }
      );
    }
    return HttpResponse.json({
      data: {
        ...mockActiveStream(id),
        progress: { status: "canceled", ratePerSecond: 0, elapsedSeconds: 1800, vestedAmount: 500, remainingAmount: 500, percentComplete: 50 },
      },
    });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  failStreamId = "stream-edge-2";
  executedCancelIds = [];
});
afterAll(() => server.close());

describe("Bulk selection edge and failure states (SSB-2026-075)", () => {
  describe("Select-all across a filtered page", () => {
    it("asserts visible state and safe action scope when select-all is clicked on filtered view", () => {
      const activeStreams = [
        mockActiveStream("stream-f1", "USDC"),
        mockActiveStream("stream-f2", "USDC"),
      ];
      const completedStreams = [
        mockCompletedStream("stream-comp1"),
      ];

      render(
        <StreamsTable
          streams={[...activeStreams, ...completedStreams]}
          filters={{ status: "active" }}
          onFiltersChange={vi.fn()}
          onCancel={vi.fn()}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onEditStartTime={vi.fn()}
        />
      );

      // Select all visible
      const selectAll = screen.getByTestId("streams-table-select-all");
      fireEvent.click(selectAll);

      // Asserts visible state: Filtered badge and selected count reflects only actionable streams (2)
      expect(screen.getByTestId("bulk-selection-count")).toHaveTextContent("2 streams selected");
      expect(screen.getByTestId("bulk-filtered-badge")).toHaveTextContent("Filtered");

      const cancelBtn = screen.getByTestId("bulk-cancel-action-btn");
      expect(cancelBtn).toHaveTextContent("Cancel 2 Streams");
      expect(cancelBtn).not.toBeDisabled();
    });

    it("safely handles boundary when filter yields zero actionable items", () => {
      render(
        <StreamsTable
          streams={[mockCompletedStream("stream-c1")]}
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
      expect(screen.queryByTestId("bulk-action-bar")).not.toBeInTheDocument();
    });
  });

  describe("One action in a batch failing", () => {
    it("asserts visible error state and preserves remaining failed items for safe retry", async () => {
      render(<SenderDashboard senderAddress={SENDER} />);

      await waitFor(() =>
        expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
      );

      // Select all 3 streams
      const selectAllCheckbox = screen.getAllByRole("checkbox")[0];
      fireEvent.click(selectAllCheckbox);

      // Click bulk cancel
      const bulkCancelTrigger = screen.getByText(/Bulk Cancel \(3\)/);
      fireEvent.click(bulkCancelTrigger);

      // Confirm modal
      const confirmBtn = await screen.findByRole("button", {
        name: /Yes, cancel 3 stream\(s\)/i,
      });
      fireEvent.click(confirmBtn);

      // Asserts visible error state
      await waitFor(() =>
        expect(screen.getByText("Cancellation Failed")).toBeInTheDocument()
      );

      expect(
        screen.getByText(/1 of 3 stream\(s\) could not be canceled/i)
      ).toBeInTheDocument();

      // Stream 1 and 3 succeeded, stream 2 failed
      expect(executedCancelIds).toEqual([
        "stream-edge-1",
        "stream-edge-2",
        "stream-edge-3",
      ]);

      // Failed item remains selected
      expect(
        screen.getByRole("button", {
          name: /Bulk cancel 1 selected stream\(s\)/i,
        })
      ).toBeInTheDocument();

      // Retry button is available
      const retryBtn = screen.getByTestId("bulk-cancel-retry-btn");
      expect(retryBtn).toBeInTheDocument();

      // Allow retry to succeed
      executedCancelIds = [];
      failStreamId = null;

      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.queryByText("Cancellation Failed")).not.toBeInTheDocument();
      });

      // Retried only the failed stream
      expect(executedCancelIds).toEqual(["stream-edge-2"]);
    });
  });
});
