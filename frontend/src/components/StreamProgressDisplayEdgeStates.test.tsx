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

function mockStreamDetail(options: {
  percentComplete: number;
  vestedAmount: number;
  remainingAmount: number;
  startAt?: number;
  status?: string;
  totalAmount?: number;
}) {
  const {
    percentComplete,
    vestedAmount,
    remainingAmount,
    startAt = 1700000000,
    status = "active",
    totalAmount = 1000,
  } = options;

  return http.get("http://localhost:3000/api/streams/:id", () =>
    HttpResponse.json({
      data: {
        id: "stream-edge-test-997",
        sender: SENDER,
        recipient: RECIPIENT,
        assetCode: "USDC",
        totalAmount,
        durationSeconds: 86400,
        startAt,
        createdAt: startAt - 100,
        progress: {
          status,
          ratePerSecond: 0.01157,
          elapsedSeconds: percentComplete === 0 ? 0 : 86400,
          vestedAmount,
          remainingAmount,
          percentComplete,
        },
      },
    })
  );
}

describe("StreamProgressDisplay edge and failure states (SSB-2026-055)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.use(
      http.get("http://localhost:3000/api/streams/:id/history", () =>
        HttpResponse.json({ events: [] })
      )
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("handles start timestamp exactly at boundary (0% vested, 100% remaining) safely", async () => {
    server.use(
      mockStreamDetail({
        percentComplete: 0,
        vestedAmount: 0,
        remainingAmount: 1000,
        status: "active",
      })
    );

    render(
      <StreamDetailDrawer
        streamId="stream-edge-test-997"
        onClose={onClose}
        walletAddress={SENDER}
        onCancel={onCancel}
        onPause={onPause}
        signAction={signAction}
      />
    );

    const progressBar = await screen.findByRole("progressbar");
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveAttribute("aria-valuenow", "0");
    expect(progressBar).toHaveAttribute(
      "aria-valuetext",
      "0% complete, 0 USDC vested, 1000 USDC remaining"
    );

    const pct = screen.getByTestId("stream-progress-pct");
    expect(pct).toHaveTextContent("0%");

    const remaining = screen.getByTestId("stream-progress-remaining");
    expect(remaining).toHaveTextContent("1000 USDC");

    // Action controls remain safely available at stream start
    const pauseBtn = screen.getByTestId("stream-pause-btn");
    expect(pauseBtn).not.toBeDisabled();
  });

  it("handles end timestamp exactly at boundary (100% vested, 0 remaining, completed status)", async () => {
    server.use(
      mockStreamDetail({
        percentComplete: 100,
        vestedAmount: 1000,
        remainingAmount: 0,
        status: "completed",
      })
    );

    render(
      <StreamDetailDrawer
        streamId="stream-edge-test-997"
        onClose={onClose}
        walletAddress={SENDER}
        onCancel={onCancel}
      />
    );

    const progressBar = await screen.findByRole("progressbar");
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveAttribute("aria-valuenow", "100");
    expect(progressBar).toHaveAttribute(
      "aria-valuetext",
      "100% complete, 1000 USDC vested, 0 USDC remaining"
    );

    const pct = screen.getByTestId("stream-progress-pct");
    expect(pct).toHaveTextContent("100%");

    const remaining = screen.getByTestId("stream-progress-remaining");
    expect(remaining).toHaveTextContent("0 USDC");

    // Once completed/finalised, cancel and modify actions are disabled or not rendered
    expect(screen.queryByTestId("stream-pause-btn")).not.toBeInTheDocument();
  });

  it("pauses background polling updates while document tab is hidden, then refreshes on visible", async () => {
    let fetchCount = 0;
    server.use(
      http.get("http://localhost:3000/api/streams/:id", () => {
        fetchCount++;
        return HttpResponse.json({
          data: {
            id: "stream-edge-test-997",
            sender: SENDER,
            recipient: RECIPIENT,
            assetCode: "USDC",
            totalAmount: 1000,
            durationSeconds: 86400,
            startAt: 1700000000,
            createdAt: 1699990000,
            progress: {
              status: "active",
              ratePerSecond: 0.01157,
              elapsedSeconds: 43200,
              vestedAmount: 500,
              remainingAmount: 500,
              percentComplete: 50,
            },
          },
        });
      })
    );

    render(
      <StreamDetailDrawer
        streamId="stream-edge-test-997"
        onClose={onClose}
        walletAddress={SENDER}
      />
    );

    await screen.findByRole("progressbar");
    expect(fetchCount).toBe(1);

    // Simulate tab hiding
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    fireEvent(document, new Event("visibilitychange"));

    // No immediate background refresh when hidden
    expect(fetchCount).toBe(1);

    // Simulate user returning to tab
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    fireEvent(document, new Event("visibilitychange"));

    // Tab returning to visible triggers fresh state refresh
    await waitFor(() => {
      expect(fetchCount).toBe(2);
    });
  });

  it("clamps out-of-boundary values (over-vested or negative remaining) gracefully", async () => {
    server.use(
      mockStreamDetail({
        percentComplete: 110,
        vestedAmount: 1100,
        remainingAmount: -100,
        status: "active",
      })
    );

    render(
      <StreamDetailDrawer
        streamId="stream-edge-test-997"
        onClose={onClose}
        walletAddress={SENDER}
      />
    );

    const progressBar = await screen.findByRole("progressbar");
    expect(progressBar).toHaveAttribute("aria-valuenow", "100");

    const pct = screen.getByTestId("stream-progress-pct");
    expect(pct).toHaveTextContent("100%");

    const remaining = screen.getByTestId("stream-progress-remaining");
    expect(remaining).toHaveTextContent("0 USDC");
  });
});
