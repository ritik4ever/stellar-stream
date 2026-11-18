import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SenderDashboard } from "./SenderDashboard";
import { Stream } from "../types/stream";

const SENDER = "GSENDER_BULK_MOBILE_TEST";

const mockActiveStream = (id: string, recipient = "GRECIPIENT_TEST_LONG_ADDRESS_56CHARS"): Stream => ({
  id,
  sender: SENDER,
  recipient,
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

const mockCanceledStream = (id: string): Stream => ({
  ...mockActiveStream(id),
  progress: {
    status: "canceled",
    ratePerSecond: 0,
    elapsedSeconds: 1800,
    vestedAmount: 500,
    remainingAmount: 500,
    percentComplete: 50,
  },
});

const server = setupServer(
  http.get("/api/streams", () =>
    HttpResponse.json({
      data: [
        mockActiveStream("bulk-s1"),
        mockActiveStream("bulk-s2"),
      ],
    })
  ),
  http.get("/api/streams/sender/:address", () =>
    HttpResponse.json({
      data: [
        mockActiveStream("bulk-s1"),
        mockActiveStream("bulk-s2"),
      ],
    })
  ),
  http.get("/api/streams/sender/:address/events", () => HttpResponse.json({ data: [] })),
  http.get("/api/streams/:id/history", () => HttpResponse.json({ data: [] }))
);

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("Bulk selection mobile usability and partial failure handling (SSB-2026-074)", () => {
  it("keeps bulk selection actionable with 44px touch targets on narrow viewports", async () => {
    render(
      <div style={{ width: "320px", overflow: "hidden" }}>
        <SenderDashboard senderAddress={SENDER} />
      </div>
    );

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    // Select all streams
    const selectAllCheckbox = screen.getAllByRole("checkbox")[0];
    fireEvent.click(selectAllCheckbox);

    // Bulk Cancel button appears in Quick Actions toolbar
    const bulkCancelBtn = screen.getByRole("button", {
      name: /Bulk cancel 2 selected stream\(s\)/i,
    });
    expect(bulkCancelBtn).toBeInTheDocument();
    expect(bulkCancelBtn).toHaveStyle({ minHeight: "44px" });
  });

  it("handles partial failure where one action in a batch fails while another succeeds", async () => {
    // S1 succeeds, S2 fails with RPC rejection
    server.use(
      http.post("/api/streams/:id/cancel", ({ params }) => {
        if (params.id === "bulk-s2") {
          return HttpResponse.json(
            { error: "Stellar RPC transaction timeout" },
            { status: 500 }
          );
        }
        return HttpResponse.json({ data: mockCanceledStream(String(params.id)) });
      })
    );

    render(<SenderDashboard senderAddress={SENDER} />);

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    // Select all
    const selectAllCheckbox = screen.getAllByRole("checkbox")[0];
    fireEvent.click(selectAllCheckbox);

    // Click Bulk Cancel
    const bulkCancelBtn = screen.getByText(/Bulk Cancel \(2\)/);
    fireEvent.click(bulkCancelBtn);

    // Confirm dialog
    const confirmBtn = await screen.findByRole("button", {
      name: /Yes, cancel 2 stream\(s\)/i,
    });
    fireEvent.click(confirmBtn);

    // Error banner appears indicating partial failure
    await waitFor(() =>
      expect(screen.getByText(/Cancellation Failed/)).toBeInTheDocument()
    );
    expect(
      screen.getAllByText(/1 of 2 stream\(s\) could not be canceled/i)[0]
    ).toBeInTheDocument();

    // The failed stream remains selected for retry
    expect(
      screen.getByRole("button", {
        name: /Bulk cancel 1 selected stream\(s\)/i,
      })
    ).toBeInTheDocument();
  });
});
