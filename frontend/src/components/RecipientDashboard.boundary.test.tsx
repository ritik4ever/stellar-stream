import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { RecipientDashboard } from "./RecipientDashboard";
import { Stream } from "../types/stream";

const RECIPIENT = "GRECIPIENT_BOUNDARY_TEST";

const mockUnvestedStream = (id: string): Stream => ({
  id,
  sender: "GSENDER_TEST",
  recipient: RECIPIENT,
  assetCode: "USDC",
  totalAmount: 1000,
  durationSeconds: 3600,
  startAt: Math.floor(Date.now() / 1000) + 1800,
  createdAt: Math.floor(Date.now() / 1000),
  progress: {
    status: "active",
    ratePerSecond: 0.27,
    elapsedSeconds: 0,
    vestedAmount: 0,
    remainingAmount: 1000,
    percentComplete: 0,
  },
});

const mockVestedStream = (id: string): Stream => ({
  ...mockUnvestedStream(id),
  progress: {
    status: "active",
    ratePerSecond: 0.27,
    elapsedSeconds: 1800,
    vestedAmount: 500,
    remainingAmount: 500,
    percentComplete: 50,
  },
});

const server = setupServer(
  http.get("/api/streams", () => HttpResponse.json({ data: [] })),
  http.get("/api/streams/recipient/:address", () =>
    HttpResponse.json({
      data: [mockUnvestedStream("stream-u1"), mockUnvestedStream("stream-u2")],
    })
  )
);

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("RecipientDashboard boundary states (SSB-2026-026)", () => {
  it("renders an explicit boundary notice and disabled action when recipient has active streams but zero claimable balance", async () => {
    render(<RecipientDashboard recipientAddress={RECIPIENT} />);

    await waitFor(() =>
      expect(screen.getByText("Recipient Dashboard")).toBeInTheDocument()
    );

    // Verify explicit boundary notice
    const notice = await screen.findByTestId("no-claimable-notice");
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveTextContent("No claimable balance yet.");

    // Claim buttons should explicitly indicate 'Nothing to claim' and be disabled
    const claimButtons = screen.getAllByRole("button", { name: /from stream/i });
    expect(claimButtons.length).toBe(2);
    expect(claimButtons[0]).toHaveTextContent("Nothing to claim");
    expect(claimButtons[0]).toBeDisabled();

    // Claim all button must be disabled
    const claimAllBtn = screen.getByRole("button", { name: /No claimable streams to claim/i });
    expect(claimAllBtn).toBeDisabled();
  });

  it("shows enabled claim controls when funds are actually vested", async () => {
    server.use(
      http.get("/api/streams/recipient/:address", () =>
        HttpResponse.json({ data: [mockVestedStream("stream-v1")] })
      )
    );

    render(<RecipientDashboard recipientAddress={RECIPIENT} />);

    await waitFor(() =>
      expect(screen.getByText("Recipient Dashboard")).toBeInTheDocument()
    );

    // No zero-balance notice when claimable balance exists
    expect(screen.queryByTestId("no-claimable-notice")).not.toBeInTheDocument();

    const claimBtn = await screen.findByRole("button", { name: /Claim 500 USDC from stream stream-v1/i });
    expect(claimBtn).toBeInTheDocument();
    expect(claimBtn).not.toBeDisabled();
    expect(claimBtn).toHaveTextContent("Claim 500 USDC");
  });
});
