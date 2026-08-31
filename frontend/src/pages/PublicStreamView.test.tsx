/**
 * Tests for the public stream view (issue #743).
 *
 * Covers:
 * - Loads and renders a stream without any wallet (public access)
 * - Shows live progress, status, and the vesting clock
 * - Scheduled streams show a countdown to start
 * - Sender/recipient addresses are truncated (sensitive data hidden)
 * - Not-found streams render a friendly error state
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { server } from "../server";
import { clearCache } from "../services/api";
import { PublicStreamView } from "./PublicStreamView";
import { Stream } from "../types/stream";

const FULL_SENDER = "GSENDER1234567890";
const FULL_RECIPIENT = "GRECIPIENTABCDEFGH";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function makeStream(overrides: Partial<Stream> = {}): Stream {
  const now = nowSeconds();
  return {
    id: "s1",
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

function setupStreamHandler(stream: Stream | null, id: string = "s1") {
  server.use(
    http.get(`/api/streams/${id}`, () => {
      if (!stream) {
        return HttpResponse.json({ error: "Stream not found." }, { status: 404 });
      }
      return HttpResponse.json({ data: stream });
    }),
  );
}

function renderView(id: string = "s1") {
  return render(
    <MemoryRouter initialEntries={[`/stream/${id}`]}>
      <Routes>
        <Route path="/stream/:streamId" element={<PublicStreamView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PublicStreamView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCache();
  });

  it("renders stream progress and status without any wallet", async () => {
    setupStreamHandler(makeStream());
    renderView();

    await waitFor(() => {
      expect(screen.getByText("Stream Status")).toBeInTheDocument();
    });

    // Status badge
    expect(screen.getByText("Active")).toBeInTheDocument();
    // Progress bar + vesting clock labels
    expect(screen.getByRole("progressbar", { name: /stream progress/i })).toBeInTheDocument();
    expect(screen.getByText("Elapsed")).toBeInTheDocument();
    expect(screen.getByText("Remaining")).toBeInTheDocument();
    // Key metrics
    expect(screen.getByText("USDC")).toBeInTheDocument();
    expect(screen.getByText(/1,000 USDC vested/i)).toBeInTheDocument();
  });

  it("shows a countdown to start for scheduled streams", async () => {
    const now = nowSeconds();
    setupStreamHandler(
      makeStream({
        startAt: now + 7200,
        createdAt: now - 60,
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
    renderView();

    await waitFor(() => {
      expect(screen.getByText("Starts in")).toBeInTheDocument();
    });
    expect(screen.getByText(/2h 0m/)).toBeInTheDocument();
  });

  it("truncates sender and recipient addresses and never reveals full addresses", async () => {
    setupStreamHandler(makeStream());
    renderView();

    await waitFor(() => {
      expect(screen.getByText("Stream Status")).toBeInTheDocument();
    });

    expect(screen.getByText("GSENDER1…7890")).toBeInTheDocument();
    expect(screen.getByText("GRECIPIE…EFGH")).toBeInTheDocument();

    // Full addresses must not appear anywhere (text or title attributes)
    expect(screen.queryByText(FULL_SENDER)).not.toBeInTheDocument();
    expect(screen.queryByText(FULL_RECIPIENT)).not.toBeInTheDocument();
    const fullAddressInTitle = Array.from(document.querySelectorAll<HTMLElement>("[title]")).some(
      (el) =>
        el.getAttribute("title")?.includes(FULL_SENDER) ||
        el.getAttribute("title")?.includes(FULL_RECIPIENT),
    );
    expect(fullAddressInTitle).toBe(false);
  });

  it("renders a friendly not-found state for missing streams", async () => {
    setupStreamHandler(null);
    renderView("missing");

    await waitFor(() => {
      expect(screen.getByText("Stream Not Found")).toBeInTheDocument();
    });
    expect(screen.getByText(/could not be found/i)).toBeInTheDocument();
  });
});
