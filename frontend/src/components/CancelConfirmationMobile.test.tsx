import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SenderDashboard } from "./SenderDashboard";
import { Stream } from "../types/stream";

const SENDER = "GSENDER_CANCEL_MOBILE_TEST";

const mockLongStream = (id: string): Stream => ({
  id,
  sender: SENDER,
  recipient: "GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6",
  assetCode: "USDC",
  totalAmount: 5000,
  durationSeconds: 3600,
  startAt: Math.floor(Date.now() / 1000) - 1800,
  createdAt: Math.floor(Date.now() / 1000) - 1800,
  progress: {
    status: "active",
    ratePerSecond: 1.38,
    elapsedSeconds: 1800,
    vestedAmount: 2500,
    remainingAmount: 2500,
    percentComplete: 50,
  },
});

const server = setupServer(
  http.get("/api/streams", () => HttpResponse.json({ data: [mockLongStream("stream-long-account-mobile-1")] })),
  http.get("/api/streams/sender/:address", () =>
    HttpResponse.json({ data: [mockLongStream("stream-long-account-mobile-1")] })
  ),
  http.get("/api/streams/sender/:address/events", () => HttpResponse.json({ data: [] })),
  http.get("/api/streams/:id/history", () => HttpResponse.json({ data: [] }))
);

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

describe("Cancel confirmation mobile usability on narrow screens (SSB-2026-069)", () => {
  it("renders cancel confirmation modal without clipping on 320px viewport", async () => {
    render(
      <div style={{ width: "320px", overflowX: "hidden" }}>
        <SenderDashboard senderAddress={SENDER} />
      </div>
    );

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    const cancelBtn = screen.getByRole("button", { name: /Cancel stream to/i });
    fireEvent.click(cancelBtn);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveStyle({
      maxWidth: "100%",
      boxSizing: "border-box",
      overflowWrap: "anywhere",
      wordBreak: "break-word",
    });

    const prompt = screen.getByTestId("cancel-confirm-prompt");
    expect(prompt).toBeInTheDocument();
    expect(prompt).toHaveStyle({
      overflowWrap: "anywhere",
      wordBreak: "break-word",
    });

    const recipient = screen.getByTestId("cancel-recipient-id");
    expect(recipient).toHaveStyle({ wordBreak: "break-all" });
  });

  it("enforces minimum 44px touch targets on modal action buttons", async () => {
    render(
      <div style={{ width: "320px" }}>
        <SenderDashboard senderAddress={SENDER} />
      </div>
    );

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: /Cancel stream to/i }));
    await screen.findByRole("dialog");

    const confirmBtn = screen.getByTestId("cancel-confirm-btn");
    const dismissBtn = screen.getByTestId("cancel-dismiss-btn");

    expect(confirmBtn).toHaveStyle({ minHeight: "44px", minWidth: "44px" });
    expect(dismissBtn).toHaveStyle({ minHeight: "44px", minWidth: "44px" });

    const actionsContainer = screen.getByTestId("cancel-modal-actions");
    expect(actionsContainer).toHaveStyle({
      display: "flex",
      flexWrap: "wrap",
    });
  });

  it("maintains accessible touch targets on 768px tablet viewport", async () => {
    render(
      <div style={{ width: "768px" }}>
        <SenderDashboard senderAddress={SENDER} />
      </div>
    );

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: /Cancel stream to/i }));
    await screen.findByRole("dialog");

    expect(screen.getByTestId("cancel-confirm-btn")).toHaveStyle({ minHeight: "44px" });
    expect(screen.getByTestId("cancel-dismiss-btn")).toHaveStyle({ minHeight: "44px" });
  });
});
