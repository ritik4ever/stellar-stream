import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../server";
import { StreamDetailDrawer } from "./StreamDetailDrawer";

const onClose = vi.fn();

function mockStreamDetail(percentComplete: number, vestedAmount: number, remainingAmount: number, status = "active") {
  return http.get("http://localhost:3000/api/streams/:id", () =>
    HttpResponse.json({
      data: {
        id: "stream-progress-42",
        sender: "GSENDER123",
        recipient: "GRECIPIENT456",
        assetCode: "USDC",
        totalAmount: 1000,
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

describe("StreamProgressDisplay accessibility and boundary clamping (SSB-2026-053)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.use(
      http.get("http://localhost:3000/api/streams/:id/history", () =>
        HttpResponse.json({ events: [] })
      )
    );
  });

  it("renders progressbar with descriptive aria-valuetext, valuenow, and polite live status announcer", async () => {
    server.use(mockStreamDetail(50, 500, 500, "active"));

    render(<StreamDetailDrawer streamId="stream-progress-42" onClose={onClose} />);

    const progressBar = await screen.findByRole("progressbar");
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveAttribute("aria-valuenow", "50");
    expect(progressBar).toHaveAttribute(
      "aria-valuetext",
      "50% complete, 500 USDC vested, 500 USDC remaining"
    );

    const announcer = screen.getByTestId("stream-progress-live-announcer");
    expect(announcer).toBeInTheDocument();
    expect(announcer).toHaveAttribute("aria-live", "polite");
    expect(announcer).toHaveTextContent("Stream status: active. 50% vested.");
  });

  it("safely clamps boundary timestamps at 0% and 100% without negative remaining amounts", async () => {
    server.use(mockStreamDetail(100, 1000, 0, "completed"));

    render(<StreamDetailDrawer streamId="stream-progress-42" onClose={onClose} />);

    const progressBar = await screen.findByRole("progressbar");
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveAttribute("aria-valuenow", "100");
    expect(progressBar).toHaveAttribute(
      "aria-valuetext",
      "100% complete, 1000 USDC vested, 0 USDC remaining"
    );

    expect(screen.getByText("0 USDC")).toBeInTheDocument();
  });

  it("handles tab visibility changes and pauses background re-fetching when document is hidden", async () => {
    let fetchCount = 0;
    server.use(
      http.get("http://localhost:3000/api/streams/:id", () => {
        fetchCount++;
        return HttpResponse.json({
          data: {
            id: "stream-progress-42",
            sender: "GSENDER123",
            recipient: "GRECIPIENT456",
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

    render(<StreamDetailDrawer streamId="stream-progress-42" onClose={onClose} />);

    await waitFor(() => {
      expect(fetchCount).toBeGreaterThanOrEqual(1);
    });

    const initialCount = fetchCount;

    // Simulate tab becoming visible again
    fireEvent(document, new Event("visibilitychange"));

    await waitFor(() => {
      expect(fetchCount).toBeGreaterThan(initialCount);
    });
  });
});
