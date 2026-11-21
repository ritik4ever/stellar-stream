import React from "react";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamTimeline } from "./StreamTimeline";
import { getStreamHistory, StreamEvent } from "../services/api";

vi.mock("../services/api", () => ({
  getStreamHistory: vi.fn(),
  listAllEvents: vi.fn(),
}));

describe("StreamTimeline error recovery path (SSB-2026-057)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows an actionable error alert and message when history fetch fails", async () => {
    vi.mocked(getStreamHistory).mockRejectedValueOnce(
      new Error("Network timeout: Horizon node unreachable")
    );

    render(<StreamTimeline streamId="stream-fail-test" />);

    const errorAlert = await screen.findByRole("alert");
    expect(errorAlert).toBeInTheDocument();
    expect(screen.getByTestId("timeline-error-title")).toHaveTextContent(
      "Unable to load activity"
    );
    expect(screen.getByTestId("timeline-error-message")).toHaveTextContent(
      "Network timeout: Horizon node unreachable"
    );

    const retryBtn = screen.getByTestId("timeline-retry-btn");
    expect(retryBtn).toBeInTheDocument();
    expect(retryBtn).toHaveTextContent("Try again");
  });

  it("successfully recovers and renders event list when user clicks 'Try again'", async () => {
    // First call fails, second call succeeds
    vi.mocked(getStreamHistory)
      .mockRejectedValueOnce(new Error("RPC rate limit exceeded"))
      .mockResolvedValueOnce([
        {
          id: 55,
          streamId: "stream-fail-test",
          eventType: "created",
          timestamp: 1700000000,
          amount: 250,
        },
      ]);

    render(<StreamTimeline streamId="stream-fail-test" />);

    const retryBtn = await screen.findByTestId("timeline-retry-btn");
    expect(retryBtn).toBeInTheDocument();

    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText("Stream created")).toBeInTheDocument();
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getStreamHistory).toHaveBeenCalledTimes(2);
  });

  it("guards against duplicate in-flight retry requests on rapid button clicks", async () => {
    let resolvePromise: (events: StreamEvent[]) => void;
    const delayedPromise = new Promise<StreamEvent[]>((res) => {
      resolvePromise = res;
    });

    vi.mocked(getStreamHistory)
      .mockRejectedValueOnce(new Error("Initial transient network fault"))
      .mockImplementationOnce(() => delayedPromise);

    render(<StreamTimeline streamId="stream-debounce-test" />);

    const retryBtn = await screen.findByTestId("timeline-retry-btn");

    // Click retry rapidly 3 times
    fireEvent.click(retryBtn);
    fireEvent.click(retryBtn);
    fireEvent.click(retryBtn);

    // Initial fail (1) + retry in-flight (1) = 2 total invocations (no duplicate spam)
    expect(getStreamHistory).toHaveBeenCalledTimes(2);

    // Resolve the second in-flight promise
    resolvePromise!([
      {
        id: 77,
        streamId: "stream-debounce-test",
        eventType: "claimed",
        timestamp: 1700000000,
        amount: 50,
      },
    ]);

    await waitFor(() => {
      expect(screen.getByText("Stream claimed")).toBeInTheDocument();
    });
  });
});
