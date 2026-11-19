import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SenderDashboard } from "./SenderDashboard";
import { Stream } from "../types/stream";

const SENDER = "GSENDER_CANCEL_RECOVERY_TEST";

const mockActiveStream = (id: string, totalAmount = 1000, vestedAmount = 300): Stream => ({
  id,
  sender: SENDER,
  recipient: "GRECIPIENT_RECOVERY_TEST",
  assetCode: "USDC",
  totalAmount,
  durationSeconds: 3600,
  startAt: Math.floor(Date.now() / 1000) - 1800,
  createdAt: Math.floor(Date.now() / 1000) - 1800,
  progress: {
    status: "active",
    ratePerSecond: 0.27,
    elapsedSeconds: 1800,
    vestedAmount,
    remainingAmount: totalAmount - vestedAmount,
    percentComplete: (vestedAmount / totalAmount) * 100,
  },
});

const mockCanceledStream = (id: string): Stream => ({
  ...mockActiveStream(id),
  progress: {
    status: "canceled",
    ratePerSecond: 0,
    elapsedSeconds: 1800,
    vestedAmount: 300,
    remainingAmount: 700,
    percentComplete: 30,
  },
});

let cancelAttempts = 0;
let shouldTimeout = true;

const server = setupServer(
  http.get("/api/streams", () => HttpResponse.json({ data: [mockActiveStream("stream-timeout-1")] })),
  http.get("/api/streams/sender/:address", () => {
    return HttpResponse.json({
      data: cancelAttempts > 1 ? [mockCanceledStream("stream-timeout-1")] : [mockActiveStream("stream-timeout-1")],
    });
  }),
  http.get("/api/streams/sender/:address/events", () => HttpResponse.json({ data: [] })),
  http.get("/api/streams/:id/history", () => HttpResponse.json({ data: [] })),
  http.post("/api/streams/:id/cancel", () => {
    cancelAttempts++;
    if (shouldTimeout) {
      return HttpResponse.json(
        { message: "Cancel submission timed out while contacting Horizon RPC" },
        { status: 504 }
      );
    }
    return HttpResponse.json({ data: mockCanceledStream("stream-timeout-1") });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  cancelAttempts = 0;
  shouldTimeout = true;
});
afterAll(() => server.close());

describe("Cancel confirmation timeout and recovery path (SSB-2026-067)", () => {
  it("displays actionable recovery error when cancel submission times out", async () => {
    render(<SenderDashboard senderAddress={SENDER} />);

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    const cancelBtn = screen.getByRole("button", { name: /Cancel stream to/i });
    fireEvent.click(cancelBtn);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();

    // Confirm cancel in dialog
    const confirmBtn = screen.getByTestId("cancel-confirm-btn");
    fireEvent.click(confirmBtn);

    // Dialog closes and error box appears with timeout guidance
    const errorBox = await screen.findByTestId("cancel-error-box");
    expect(errorBox).toBeInTheDocument();

    const title = screen.getByTestId("cancel-error-title");
    expect(title).toHaveTextContent("Cancel Request Timed Out");

    const message = screen.getByTestId("cancel-error-message");
    expect(message).toHaveTextContent("timed out");
    expect(message).toHaveTextContent("Stream parameters have been preserved");

    // Actionable retry button is present
    const retryBtn = screen.getByTestId("cancel-retry-btn");
    expect(retryBtn).toBeInTheDocument();
    expect(retryBtn).toHaveTextContent("Retry Cancel");
  });

  it("successfully recovers and executes cancel on retry without duplicate dispatches", async () => {
    render(<SenderDashboard senderAddress={SENDER} />);

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    // First attempt fails with timeout
    fireEvent.click(screen.getByRole("button", { name: /Cancel stream to/i }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByTestId("cancel-confirm-btn"));

    const retryBtn = await screen.findByTestId("cancel-retry-btn");
    expect(cancelAttempts).toBe(1);

    // Switch server to succeed on retry
    shouldTimeout = false;
    fireEvent.click(retryBtn);

    // Verifies retry succeeds and clears error box
    await waitFor(() => {
      expect(screen.queryByTestId("cancel-error-box")).not.toBeInTheDocument();
    });

    expect(cancelAttempts).toBe(2);
  });

  it("allows dismissing error recovery box safely", async () => {
    render(<SenderDashboard senderAddress={SENDER} />);

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: /Cancel stream to/i }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByTestId("cancel-confirm-btn"));

    const dismissBtn = await screen.findByTestId("cancel-dismiss-error-btn");
    fireEvent.click(dismissBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("cancel-error-box")).not.toBeInTheDocument();
    });
  });
});
