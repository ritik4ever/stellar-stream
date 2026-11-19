import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SenderDashboard } from "./SenderDashboard";
import { Stream } from "../types/stream";

const SENDER = "GSENDER_BULK_RECOVERY_TEST";

const mockActive = (id: string): Stream => ({
  id,
  sender: SENDER,
  recipient: "GRECIPIENT_BULK_REC_TEST",
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

const mockCanceled = (id: string): Stream => ({
  ...mockActive(id),
  progress: {
    status: "canceled",
    ratePerSecond: 0,
    elapsedSeconds: 1800,
    vestedAmount: 500,
    remainingAmount: 500,
    percentComplete: 50,
  },
});

let s2Fail = true;
let cancelCalls: string[] = [];

const server = setupServer(
  http.get("/api/streams", () => HttpResponse.json({ data: [] })),
  http.get("/api/streams/sender/:address", () =>
    HttpResponse.json({
      data: [mockActive("stream-rec-1"), mockActive("stream-rec-2")],
    })
  ),
  http.get("/api/streams/sender/:address/events", () => HttpResponse.json({ data: [] })),
  http.get("/api/streams/:id/history", () => HttpResponse.json({ data: [] })),
  http.post("/api/streams/:id/cancel", ({ params }) => {
    const id = String(params.id);
    cancelCalls.push(id);
    if (id === "stream-rec-2" && s2Fail) {
      return HttpResponse.json(
        { message: "Timeout connecting to Soroban RPC node" },
        { status: 504 }
      );
    }
    return HttpResponse.json({ data: mockCanceled(id) });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  s2Fail = true;
  cancelCalls = [];
});
afterAll(() => server.close());

describe("Bulk selection partial failure recovery path (SSB-2026-072)", () => {
  it("handles one action in a batch failing, displays useful message, and preserves safe input for retry", async () => {
    render(<SenderDashboard senderAddress={SENDER} />);

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    // Select all streams
    const selectAllCheckbox = screen.getAllByRole("checkbox")[0];
    fireEvent.click(selectAllCheckbox);

    // Trigger Bulk Cancel
    const bulkCancelTrigger = screen.getByText(/Bulk Cancel \(2\)/);
    fireEvent.click(bulkCancelTrigger);

    // Confirm dialog
    const confirmBtn = await screen.findByRole("button", {
      name: /Yes, cancel 2 stream\(s\)/i,
    });
    fireEvent.click(confirmBtn);

    // Partial failure error banner appears
    await waitFor(() =>
      expect(screen.getByText("Cancellation Failed")).toBeInTheDocument()
    );

    expect(
      screen.getByText(/1 of 2 stream\(s\) could not be canceled/i)
    ).toBeInTheDocument();

    // Verify stream-rec-1 was dispatched and succeeded, stream-rec-2 failed
    expect(cancelCalls).toEqual(["stream-rec-1", "stream-rec-2"]);

    // Failed stream remains selected for 1-click retry
    expect(
      screen.getByRole("button", {
        name: /Bulk cancel 1 selected stream\(s\)/i,
      })
    ).toBeInTheDocument();

    // Retry control is available
    const retryBtn = screen.getByTestId("bulk-cancel-retry-btn");
    expect(retryBtn).toBeInTheDocument();
  });

  it("successfully executes retry without resending actions on succeeded streams", async () => {
    render(<SenderDashboard senderAddress={SENDER} />);

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    // Select both
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByText(/Bulk Cancel \(2\)/));
    fireEvent.click(await screen.findByRole("button", { name: /Yes, cancel 2 stream\(s\)/i }));

    const retryBtn = await screen.findByTestId("bulk-cancel-retry-btn");

    // Clear call history and allow stream-rec-2 to succeed on retry
    cancelCalls = [];
    s2Fail = false;

    fireEvent.click(retryBtn);

    // Wait for error box to clear upon successful resolution
    await waitFor(() => {
      expect(screen.queryByText("Cancellation Failed")).not.toBeInTheDocument();
    });

    // Only stream-rec-2 is retried; zero duplicate action on stream-rec-1!
    expect(cancelCalls).toEqual(["stream-rec-2"]);
  });
});
