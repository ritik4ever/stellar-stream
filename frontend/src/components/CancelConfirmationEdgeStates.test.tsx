import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { http, HttpResponse } from "msw";
import { server } from "../server";
import { SenderDashboard } from "./SenderDashboard";
import { Stream } from "../types/stream";

const SENDER = "GSENDER_CANCEL_EDGE_TEST";

const mockActiveStream = (id: string, totalAmount = 2000, vestedAmount = 500): Stream => ({
  id,
  sender: SENDER,
  recipient: "GRECIPIENT_CANCEL_EDGE_TEST",
  assetCode: "USDC",
  totalAmount,
  durationSeconds: 3600,
  startAt: Math.floor(Date.now() / 1000) - 1800,
  createdAt: Math.floor(Date.now() / 1000) - 1800,
  progress: {
    status: "active",
    ratePerSecond: 0.55,
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
    vestedAmount: 500,
    remainingAmount: 1500,
    percentComplete: 25,
  },
});

let cancelPostCalls = 0;
let cancelHandlerMode: "success" | "timeout" = "success";

beforeEach(() => {
  cancelPostCalls = 0;
  cancelHandlerMode = "success";
  server.use(
    http.get("/api/streams", () => HttpResponse.json({ data: [mockActiveStream("stream-edge-1")] })),
    http.get("/api/streams/sender/:address", () => {
      return HttpResponse.json({
        data: cancelPostCalls > 0 && cancelHandlerMode === "success"
          ? [mockCanceledStream("stream-edge-1")]
          : [mockActiveStream("stream-edge-1")],
      });
    }),
    http.get("/api/streams/sender/:address/events", () => HttpResponse.json({ data: [] })),
    http.get("/api/streams/:id/history", () => HttpResponse.json({ data: [] })),
    http.post("/api/streams/:id/cancel", () => {
      cancelPostCalls++;
      if (cancelHandlerMode === "timeout") {
        return HttpResponse.json(
          { message: "Gateway timeout: request to Horizon node timed out" },
          { status: 504 }
        );
      }
      return HttpResponse.json({ data: mockCanceledStream("stream-edge-1") });
    })
  );
});

afterEach(() => {
  cleanup();
  cancelPostCalls = 0;
  cancelHandlerMode = "success";
  vi.useRealTimers();
});

describe("Cancel confirmation edge and failure states (SSB-2026-070)", () => {
  describe("Already canceled versus active streams boundary", () => {
    it("asserts active stream confirmation state and safe cancellation action without live testnet calls", async () => {
      render(<SenderDashboard senderAddress={SENDER} />);

      await waitFor(() =>
        expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
      );

      const cancelTrigger = screen.getByRole("button", { name: /Cancel stream to/i });
      fireEvent.click(cancelTrigger);

      // Verify active modal dialog elements
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(screen.getByTestId("cancel-modal-title")).toHaveTextContent("Cancel stream?");
      expect(screen.getByTestId("cancel-refundable-amount")).toHaveTextContent("Refundable to sender: 1,500 USDC");

      const confirmBtn = screen.getByTestId("cancel-confirm-btn");
      expect(confirmBtn).not.toBeDisabled();
      expect(confirmBtn).toHaveTextContent("Yes, cancel stream");

      // Execute safe confirmation action
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });

      expect(cancelPostCalls).toBe(1);
    });

    it("asserts already canceled boundary state and ensures non-actionable disabled control", async () => {
      // Use fake setInterval so we can advance the poll cycle without real waiting
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

      let streamsData = [mockActiveStream("stream-edge-canceled")];
      server.use(
        http.get("/api/streams/sender/:address", () =>
          HttpResponse.json({ data: streamsData })
        )
      );

      render(<SenderDashboard senderAddress={SENDER} />);

      await waitFor(() =>
        expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
      );

      fireEvent.click(screen.getByRole("button", { name: /Cancel stream to/i }));
      await screen.findByRole("dialog");

      // State transition to canceled while modal is open
      streamsData = [mockCanceledStream("stream-edge-canceled")];

      // Advance poll interval to trigger background sync
      await act(async () => {
        vi.advanceTimersByTime(5100);
      });

      // Verify explicit boundary notice (async — sync'd via polling)
      await waitFor(() => {
        const title = screen.getByTestId("cancel-modal-title");
        expect(title).toHaveTextContent("Stream already canceled");
      });

      const title = screen.getByTestId("cancel-modal-title");
      expect(title).toHaveTextContent("Stream already canceled");

      const notice = screen.getByTestId("cancel-boundary-notice");
      expect(notice).toBeInTheDocument();
      expect(notice).toHaveTextContent("This stream is already canceled. Remaining unvested funds were previously refunded");

      // Verify primary action button is safely disabled and non-actionable
      const disabledBtn = screen.getByTestId("cancel-confirm-btn");
      expect(disabledBtn).toBeDisabled();
      expect(disabledBtn).toHaveAttribute("aria-disabled", "true");
      expect(disabledBtn).toHaveTextContent("Already canceled");

      // Clicking disabled action does NOT dispatch cancel call
      fireEvent.click(disabledBtn);
      expect(cancelPostCalls).toBe(0);

      // Dismissing via Close works cleanly
      const dismissBtn = screen.getByTestId("cancel-dismiss-btn");
      expect(dismissBtn).toHaveTextContent("Close");
      fireEvent.click(dismissBtn);

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });
  });

  describe("Cancel submission timing out failure state", () => {
    it("asserts visible timeout recovery state, preserves stream input, and executes safe retry", async () => {
      cancelHandlerMode = "timeout";

      render(<SenderDashboard senderAddress={SENDER} />);

      await waitFor(() =>
        expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
      );

      fireEvent.click(screen.getByRole("button", { name: /Cancel stream to/i }));
      await screen.findByRole("dialog");

      const confirmBtn = screen.getByTestId("cancel-confirm-btn");
      fireEvent.click(confirmBtn);

      // Assert visible timeout recovery alert
      const errorBox = await screen.findByTestId("cancel-error-box");
      expect(errorBox).toBeInTheDocument();

      const title = screen.getByTestId("cancel-error-title");
      expect(title).toHaveTextContent("Cancel Request Timed Out");

      const message = screen.getByTestId("cancel-error-message");
      expect(message).toHaveTextContent("timed out");
      expect(message).toHaveTextContent("Stream parameters have been preserved");

      // Assert safe retry action without duplicate dispatches
      const retryBtn = screen.getByTestId("cancel-retry-btn");
      expect(retryBtn).toBeInTheDocument();
      expect(cancelPostCalls).toBe(1);

      // Switch to success for retry attempt
      cancelHandlerMode = "success";
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.queryByTestId("cancel-error-box")).not.toBeInTheDocument();
      });

      expect(cancelPostCalls).toBe(2);
    });

    it("verifies safe error dismissal without mutation side-effects", async () => {
      cancelHandlerMode = "timeout";

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
});
