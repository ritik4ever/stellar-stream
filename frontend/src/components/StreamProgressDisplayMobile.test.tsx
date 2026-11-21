import React from "react";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../server";
import { StreamDetailDrawer } from "./StreamDetailDrawer";

const onClose = vi.fn();
const onCancel = vi.fn();
const onPause = vi.fn();
const onResume = vi.fn();
const signAction = vi.fn();

const SENDER = "GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6";
const RECIPIENT = "GDBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E";

function mockStreamDetail(
  percentComplete: number,
  vestedAmount: number,
  remainingAmount: number,
  status = "active",
  id = "stream-mobile-test-996",
  totalAmount = 1000,
) {
  return http.get("http://localhost:3000/api/streams/:id", () =>
    HttpResponse.json({
      data: {
        id,
        sender: SENDER,
        recipient: RECIPIENT,
        assetCode: "USDC",
        totalAmount,
        durationSeconds: 86400,
        startAt: 1700000000,
        createdAt: 1699990000,
        progress: {
          status,
          ratePerSecond: 0.01157,
          elapsedSeconds: 43200,
          vestedAmount,
          remainingAmount,
          percentComplete,
        },
      },
    })
  );
}

describe("StreamProgressDisplay mobile responsiveness on narrow screens (SSB-2026-054)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.use(
      http.get("http://localhost:3000/api/streams/:id/history", () =>
        HttpResponse.json({ data: [] })
      )
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("renders progress header and amounts with flex-wrap and word-break on 320px screen", async () => {
    server.use(mockStreamDetail(50, 500, 500, "active"));

    render(
      <div style={{ width: "320px", overflowX: "hidden" }}>
        <StreamDetailDrawer
          streamId="stream-mobile-test-996"
          onClose={onClose}
          walletAddress={SENDER}
          onCancel={onCancel}
          onPause={onPause}
          signAction={signAction}
        />
      </div>
    );

    const progressHeader = await screen.findByTestId("stream-progress-header");
    expect(progressHeader).toBeInTheDocument();
    expect(progressHeader).toHaveStyle({ display: "flex", flexWrap: "wrap" });

    const pct = screen.getByTestId("stream-progress-pct");
    expect(pct).toHaveTextContent("50%");

    const vestedLabel = screen.getByTestId("stream-progress-vested-label");
    expect(vestedLabel).toHaveTextContent("500 / 1000 USDC vested");
    expect(vestedLabel).toHaveStyle({ wordBreak: "break-word" });
  });

  it("renders action buttons with >=44px minimum touch targets and flex-wrap on narrow screens", async () => {
    server.use(mockStreamDetail(50, 500, 500, "active"));

    render(
      <div style={{ width: "320px" }}>
        <StreamDetailDrawer
          streamId="stream-mobile-test-996"
          onClose={onClose}
          walletAddress={SENDER}
          onCancel={onCancel}
          onPause={onPause}
          signAction={signAction}
        />
      </div>
    );

    const pauseBtn = await screen.findByTestId("stream-pause-btn");
    expect(pauseBtn).toBeInTheDocument();
    expect(pauseBtn).toHaveStyle({ minHeight: "44px", minWidth: "44px" });

    const cancelBtn = screen.getByTestId("stream-cancel-btn");
    expect(cancelBtn).toBeInTheDocument();
    expect(cancelBtn).toHaveStyle({ minHeight: "44px", minWidth: "44px" });
  });

  it("renders remaining and rate rows with word-break to prevent horizontal clipping on 320px and 768px viewports", async () => {
    server.use(mockStreamDetail(75, 750, 250, "active"));

    const { rerender } = render(
      <div style={{ width: "320px", overflowX: "hidden" }}>
        <StreamDetailDrawer
          streamId="stream-mobile-test-996"
          onClose={onClose}
          walletAddress={SENDER}
        />
      </div>
    );

    const remaining = await screen.findByTestId("stream-progress-remaining");
    expect(remaining).toHaveTextContent("250 USDC");
    expect(remaining).toHaveStyle({ wordBreak: "break-all" });

    // Check on 768px tablet layout
    rerender(
      <div style={{ width: "768px" }}>
        <StreamDetailDrawer
          streamId="stream-mobile-test-996"
          onClose={onClose}
          walletAddress={SENDER}
        />
      </div>
    );

    expect(remaining).toHaveTextContent("250 USDC");
  });

  it("keeps a long stream ID, large amount, and canceled status available at 320px and 768px", async () => {
    const streamId = `stream-${"account".repeat(14)}`;
    const totalAmount = 987654321012345;
    server.use(
      mockStreamDetail(
        12.5,
        123456789012345,
        864197532000000,
        "canceled",
        streamId,
        totalAmount,
      ),
    );

    const { container, rerender } = render(
      <div style={{ width: "320px", overflowX: "hidden" }}>
        <StreamDetailDrawer streamId={streamId} onClose={onClose} onCancel={onCancel} />
      </div>,
    );

    const streamCode = await screen.findByText(streamId);
    expect(streamCode).toHaveClass("drawer-code");
    expect(screen.getByText(`${totalAmount} USDC`)).toBeInTheDocument();
    expect(screen.getByText("canceled", { exact: true })).toBeInTheDocument();
    expect(screen.getByLabelText("Canceled stream")).toBeInTheDocument();
    expect(screen.queryByTestId("stream-cancel-btn")).not.toBeInTheDocument();
    expect(container.querySelector(".drawer-panel")).toBeInTheDocument();

    rerender(
      <div style={{ width: "768px" }}>
        <StreamDetailDrawer streamId={streamId} onClose={onClose} onCancel={onCancel} />
      </div>,
    );

    expect(streamCode).toHaveTextContent(streamId);
    expect(screen.getByText(`${totalAmount} USDC`)).toBeInTheDocument();
    expect(screen.getByLabelText("Canceled stream")).toBeInTheDocument();
  });
});
