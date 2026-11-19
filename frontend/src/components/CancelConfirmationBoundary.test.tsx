import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SenderDashboard } from "./SenderDashboard";
import { Stream } from "../types/stream";

const SENDER = "GSENDER_CANCEL_BOUNDARY_TEST";

const mockActive = (id: string, totalAmount = 1000, vestedAmount = 250): Stream => ({
  id,
  sender: SENDER,
  recipient: "GRECIPIENT_BOUNDARY_TEST",
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

const mockCanceled = (id: string): Stream => ({
  ...mockActive(id),
  progress: {
    status: "canceled",
    ratePerSecond: 0,
    elapsedSeconds: 1800,
    vestedAmount: 250,
    remainingAmount: 750,
    percentComplete: 25,
  },
});

const mockCompleted = (id: string): Stream => ({
  ...mockActive(id),
  progress: {
    status: "completed",
    ratePerSecond: 0,
    elapsedSeconds: 3600,
    vestedAmount: 1000,
    remainingAmount: 0,
    percentComplete: 100,
  },
});

const server = setupServer(
  http.get("/api/streams", () => HttpResponse.json({ data: [mockActive("stream-active-1")] })),
  http.get("/api/streams/sender/:address", () =>
    HttpResponse.json({ data: [mockActive("stream-active-1")] })
  ),
  http.get("/api/streams/sender/:address/events", () => HttpResponse.json({ data: [] })),
  http.get("/api/streams/:id/history", () => HttpResponse.json({ data: [] })),
  http.post("/api/streams/:id/cancel", () =>
    HttpResponse.json({ data: mockCanceled("stream-active-1") })
  )
);

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

describe("Cancel confirmation boundary state handling (SSB-2026-066)", () => {
  it("renders active ready-to-act confirmation modal for active streams", async () => {
    render(<SenderDashboard senderAddress={SENDER} />);

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    const cancelBtn = screen.getByRole("button", { name: /Cancel stream to/i });
    fireEvent.click(cancelBtn);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();

    // Asserts active title and description
    expect(screen.getByTestId("cancel-modal-title")).toHaveTextContent("Cancel stream?");
    expect(screen.getByTestId("cancel-confirm-prompt")).toHaveTextContent("Are you sure you want to cancel stream");
    expect(screen.getByTestId("cancel-refundable-amount")).toHaveTextContent("Refundable to sender: 750 USDC");

    // Asserts ready-to-act confirm button
    const confirmBtn = screen.getByTestId("cancel-confirm-btn");
    expect(confirmBtn).not.toBeDisabled();
    expect(confirmBtn).toHaveTextContent("Yes, cancel stream");

    // Asserts dismiss button
    const dismissBtn = screen.getByTestId("cancel-dismiss-btn");
    expect(dismissBtn).toHaveTextContent("Keep stream");
  });

  it("renders explicit boundary notice and disabled non-actionable control for already canceled stream", async () => {
    // Initial load has active stream, then switches to canceled when modal is invoked
    let currentStreams = [mockActive("stream-boundary-canceled")];
    server.use(
      http.get("/api/streams/sender/:address", () =>
        HttpResponse.json({ data: currentStreams })
      )
    );

    const { rerender } = render(<SenderDashboard senderAddress={SENDER} />);

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    const cancelBtn = screen.getByRole("button", { name: /Cancel stream to/i });
    fireEvent.click(cancelBtn);

    await screen.findByRole("dialog");

    // Simulate backend state transition to canceled while stream is targeted
    currentStreams = [mockCanceled("stream-boundary-canceled")];
    rerender(<SenderDashboard senderAddress={SENDER} />);

    // Asserts explicit boundary state
    const title = screen.getByTestId("cancel-modal-title");
    expect(title).toHaveTextContent("Stream already canceled");

    const boundaryNotice = screen.getByTestId("cancel-boundary-notice");
    expect(boundaryNotice).toBeInTheDocument();
    expect(boundaryNotice).toHaveTextContent("This stream is already canceled. Remaining unvested funds were previously refunded");

    // Asserts primary action is disabled with informative status instead of misleading cancel trigger
    const confirmBtn = screen.getByTestId("cancel-confirm-btn");
    expect(confirmBtn).toBeDisabled();
    expect(confirmBtn).toHaveAttribute("aria-disabled", "true");
    expect(confirmBtn).toHaveTextContent("Already canceled");

    // Asserts dismiss button reflects safe exit
    const dismissBtn = screen.getByTestId("cancel-dismiss-btn");
    expect(dismissBtn).toHaveTextContent("Close");

    fireEvent.click(dismissBtn);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
  });

  it("renders explicit boundary notice and disabled non-actionable control for already completed stream", async () => {
    let currentStreams = [mockActive("stream-boundary-completed")];
    server.use(
      http.get("/api/streams/sender/:address", () =>
        HttpResponse.json({ data: currentStreams })
      )
    );

    const { rerender } = render(<SenderDashboard senderAddress={SENDER} />);

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    const cancelBtn = screen.getByRole("button", { name: /Cancel stream to/i });
    fireEvent.click(cancelBtn);

    await screen.findByRole("dialog");

    // Stream completes
    currentStreams = [mockCompleted("stream-boundary-completed")];
    rerender(<SenderDashboard senderAddress={SENDER} />);

    expect(screen.getByTestId("cancel-modal-title")).toHaveTextContent("Stream already completed");

    const boundaryNotice = screen.getByTestId("cancel-boundary-notice");
    expect(boundaryNotice).toBeInTheDocument();
    expect(boundaryNotice).toHaveTextContent("This stream has already completed. All funds have been fully vested and claimed");

    const confirmBtn = screen.getByTestId("cancel-confirm-btn");
    expect(confirmBtn).toBeDisabled();
    expect(confirmBtn).toHaveTextContent("Already completed");
  });
});
