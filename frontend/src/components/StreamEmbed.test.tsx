/**
 * Tests for the standalone stream embed widget (issue #743).
 *
 * Covers:
 * - Renders key metrics, status, and progress inside the compact widget
 * - Scheduled streams show a countdown to start
 * - Sender/recipient addresses are truncated (no sensitive data leaked)
 * - Renders an error state when the stream cannot be loaded
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { server } from "../server";
import { clearCache } from "../services/api";
import { StreamEmbed } from "./StreamEmbed";
import { Stream } from "../types/stream";

const FULL_SENDER = "GSENDER1234567890";
const FULL_RECIPIENT = "GRECIPIENTABCDEFGH";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function makeStream(overrides: Partial<Stream> = {}): Stream {
  const now = nowSeconds();
  return {
    id: "e1",
    sender: FULL_SENDER,
    recipient: FULL_RECIPIENT,
    assetCode: "USDC",
    totalAmount: 1000,
    durationSeconds: 86400,
    startAt: now - 3600,
    createdAt: now - 7200,
    progress: {
      status: "active",
      ratePerSecond: 0.01,
      elapsedSeconds: 3600,
      vestedAmount: 36,
      remainingAmount: 964,
      percentComplete: 3.6,
    },
    ...overrides,
  };
}

function setupStreamHandler(stream: Stream | null, id: string = "e1") {
  server.use(
    http.get(`/api/streams/${id}`, () => {
      if (!stream) {
        return HttpResponse.json({ error: "Stream not found." }, { status: 404 });
      }
      return HttpResponse.json({ data: stream });
    }),
  );
}

function renderEmbed(id: string = "e1") {
  return render(
    <MemoryRouter initialEntries={[`/embed/${id}`]}>
      <Routes>
        <Route path="/embed/:streamId" element={<StreamEmbed />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("StreamEmbed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCache();
  });

  it("renders progress, status, and key metrics for an active stream", async () => {
    setupStreamHandler(makeStream());
    renderEmbed();

    await waitFor(() => {
      expect(screen.getByText("StellarStream")).toBeInTheDocument();
    });

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /stream progress/i })).toBeInTheDocument();
    expect(screen.getByText(/1,000 USDC/)).toBeInTheDocument();
    expect(screen.getByText("Remaining")).toBeInTheDocument();
  });

  it("shows a countdown to start for scheduled streams", async () => {
    const now = nowSeconds();
    setupStreamHandler(
      makeStream({
        startAt: now + 7200,
        progress: {
          status: "scheduled",
          ratePerSecond: 0,
          elapsedSeconds: 0,
          vestedAmount: 0,
          remainingAmount: 500,
          percentComplete: 0,
        },
        totalAmount: 500,
      }),
    );
    renderEmbed();

    await waitFor(() => {
      expect(screen.getByText("Starts in")).toBeInTheDocument();
    });
    expect(screen.getByText(/2h 0m/)).toBeInTheDocument();
  });

  it("truncates addresses and does not leak full wallet addresses", async () => {
    setupStreamHandler(makeStream());
    renderEmbed();

    await waitFor(() => {
      expect(screen.getByText("StellarStream")).toBeInTheDocument();
    });

    expect(screen.getByText("GSENDER1…7890")).toBeInTheDocument();
    expect(screen.getByText("GRECIPIE…EFGH")).toBeInTheDocument();

    expect(screen.queryByText(FULL_SENDER)).not.toBeInTheDocument();
    expect(screen.queryByText(FULL_RECIPIENT)).not.toBeInTheDocument();
    const leaks = Array.from(document.querySelectorAll<HTMLElement>("[title]")).some(
      (el) =>
        el.getAttribute("title")?.includes(FULL_SENDER) ||
        el.getAttribute("title")?.includes(FULL_RECIPIENT),
    );
    expect(leaks).toBe(false);
  });

  it("renders an error state when the stream cannot be loaded", async () => {
    setupStreamHandler(null);
    renderEmbed("missing");

    await waitFor(() => {
      expect(screen.getByText("Stream unavailable")).toBeInTheDocument();
    });
  });
});
