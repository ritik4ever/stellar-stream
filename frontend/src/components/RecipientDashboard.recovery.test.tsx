import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { RecipientDashboard } from "./RecipientDashboard";
import { Stream } from "../types/stream";

const ADDRESS_A = "GRECIPIENT_RECOVERY_A";
const ADDRESS_B = "GRECIPIENT_RECOVERY_B";

const mockStream = (id: string, recipient: string): Stream => ({
  id,
  sender: "GSENDER_TEST",
  recipient,
  assetCode: "USDC",
  totalAmount: 500,
  durationSeconds: 3600,
  startAt: Math.floor(Date.now() / 1000) - 1800,
  createdAt: Math.floor(Date.now() / 1000) - 1800,
  progress: {
    status: "active",
    ratePerSecond: 0.14,
    elapsedSeconds: 1800,
    vestedAmount: 250,
    remainingAmount: 250,
    percentComplete: 50,
  },
});

let failAttempt = true;

const server = setupServer(
  http.get("/api/streams", () => HttpResponse.json({ data: [] })),
  http.get("/api/streams/recipient/:address", ({ params }) => {
    const address = String(params.address);
    if (address === ADDRESS_A && failAttempt) {
      return HttpResponse.json(
        { error: "Network timeout connecting to horizon gateway" },
        { status: 500 }
      );
    }
    return HttpResponse.json({ data: [mockStream(`stream-${address}`, address)] });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
beforeEach(() => {
  failAttempt = true;
  server.resetHandlers();
});
afterAll(() => server.close());

describe("RecipientDashboard recovery and wallet switching (SSB-2026-027)", () => {
  it("shows a useful message on simulated failure and successfully loads streams on retry", async () => {
    render(<RecipientDashboard recipientAddress={ADDRESS_A} />);

    // Shows useful error message on failure
    const errorBox = await screen.findByRole("alert");
    expect(errorBox).toBeInTheDocument();
    expect(screen.getByText("Dashboard Load Failed")).toBeInTheDocument();
    expect(
      screen.getByText(/Network timeout connecting to horizon gateway/i)
    ).toBeInTheDocument();

    // Retry button is available and works
    const retryBtn = screen.getByTestId("recipient-retry-btn");
    expect(retryBtn).toBeInTheDocument();

    // Next attempt succeeds
    failAttempt = false;
    fireEvent.click(retryBtn);

    // Verify recovery
    await waitFor(() =>
      expect(screen.getByText("Recipient Dashboard")).toBeInTheDocument()
    );
    expect(screen.queryByText("Dashboard Load Failed")).not.toBeInTheDocument();
    expect(screen.getByText(`stream-${ADDRESS_A}`)).toBeInTheDocument();
  });

  it("handles switching wallet accounts cleanly without race conditions or state pollution", async () => {
    failAttempt = false;
    const { rerender } = render(<RecipientDashboard recipientAddress={ADDRESS_A} />);

    await waitFor(() =>
      expect(screen.getByText(`stream-${ADDRESS_A}`)).toBeInTheDocument()
    );

    // Switch wallet address mid-workflow
    rerender(<RecipientDashboard recipientAddress={ADDRESS_B} />);

    await waitFor(() =>
      expect(screen.getByText(`stream-${ADDRESS_B}`)).toBeInTheDocument()
    );
    expect(screen.queryByText(`stream-${ADDRESS_A}`)).not.toBeInTheDocument();
  });
});
