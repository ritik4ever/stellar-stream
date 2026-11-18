import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SenderDashboard } from "./SenderDashboard";
import { Stream } from "../types/stream";

const SENDER = "GSENDER_CANCEL_A11Y_TEST";

const mockActive = (id: string, totalAmount = 1000, vestedAmount = 250): Stream => ({
  id,
  sender: SENDER,
  recipient: "GRECIPIENT_TEST",
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

const server = setupServer(
  http.get("/api/streams", () => HttpResponse.json({ data: [mockActive("stream-1010")] })),
  http.get("/api/streams/sender/:address", () =>
    HttpResponse.json({ data: [mockActive("stream-1010")] })
  ),
  http.get("/api/streams/sender/:address/events", () => HttpResponse.json({ data: [] })),
  http.get("/api/streams/:id/history", () => HttpResponse.json({ data: [] })),
  http.post("/api/streams/:id/cancel", () =>
    HttpResponse.json({ data: mockCanceled("stream-1010") })
  )
);

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("Cancel confirmation accessibility and keyboard workflow (SSB-2026-068)", () => {
  it("displays accessible cancel modal with refundable amount and irreversible action prompt", async () => {
    render(<SenderDashboard senderAddress={SENDER} />);

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    const cancelBtn = screen.getByRole("button", { name: /Cancel stream to/i });
    fireEvent.click(cancelBtn);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "cancel-confirm-title");
    expect(dialog).toHaveAttribute("aria-describedby", "cancel-confirm-desc");

    expect(screen.getByText(/This irreversible action will terminate the stream/i)).toBeInTheDocument();
    expect(screen.getByTestId("cancel-refundable-amount")).toHaveTextContent("Refundable to sender: 750 USDC");
  });

  it("supports keyboard-only dismissal with Escape key", async () => {
    render(<SenderDashboard senderAddress={SENDER} />);

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: /Cancel stream to/i }));
    await screen.findByRole("dialog");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
  });

  it("handles already canceled streams safely by preventing duplicate cancel actions", async () => {
    server.use(
      http.get("/api/streams", () =>
        HttpResponse.json({ data: [mockCanceled("stream-1010")] })
      ),
      http.get("/api/streams/sender/:address", () =>
        HttpResponse.json({ data: [mockCanceled("stream-1010")] })
      )
    );

    render(<SenderDashboard senderAddress={SENDER} />);

    await waitFor(() =>
      expect(screen.getByText("Sender Dashboard")).toBeInTheDocument()
    );

    // Cancel action is absent or disabled for already canceled streams
    expect(screen.queryByRole("button", { name: /Cancel stream to/i })).not.toBeInTheDocument();
  });
});
