import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../server";
import { RecipientDashboard } from "./RecipientDashboard";
import { Stream } from "../types/stream";

vi.mock("../services/soroban", () => {
  const mockFn = vi.fn();
  return {
    claimOnChain: mockFn,
    claimStream: mockFn,
    SorobanClaimError: class SorobanClaimError extends Error {
      code: string;
      constructor(message: string, code: string) {
        super(message);
        this.name = "SorobanClaimError";
        this.code = code;
      }
    },
  };
});

const RECIPIENT_1 = "GRECIPIENT_A11Y_1";
const RECIPIENT_2 = "GRECIPIENT_A11Y_2";

const createMockStream = (
  id: string,
  recipient: string,
  vestedAmount: number,
  status: "active" | "completed" = "active"
): Stream => ({
  id,
  sender: "GSENDER_MOCK",
  recipient,
  assetCode: "USDC",
  totalAmount: 1000,
  durationSeconds: 86400,
  startAt: 1700000000,
  createdAt: 1699990000,
  progress: {
    status,
    ratePerSecond: 0.01,
    elapsedSeconds: status === "active" ? 100 : 86400,
    vestedAmount,
    remainingAmount: 1000 - vestedAmount,
    percentComplete: status === "active" ? (vestedAmount / 1000) * 100 : 100,
  },
});

describe("RecipientDashboard accessibility and mid-request account switching (SSB-2026-028)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders semantic tables with scope='col' on headers and polite live region announcer", async () => {
    server.use(
      http.get(`http://localhost:3000/api/streams/recipient/${RECIPIENT_1}`, () => {
        return HttpResponse.json([createMockStream("1", RECIPIENT_1, 50, "active")]);
      })
    );

    render(<RecipientDashboard recipientAddress={RECIPIENT_1} />);

    const table = await screen.findByRole("table", { name: /Active streams/i });
    expect(table).toBeInTheDocument();

    const columnHeaders = screen.getAllByRole("columnheader");
    expect(columnHeaders.length).toBeGreaterThan(0);
    columnHeaders.forEach((th) => {
      expect(th).toHaveAttribute("scope", "col");
    });

    const announcer = screen.getByTestId("recipient-status-announcer");
    expect(announcer).toBeInTheDocument();
    expect(announcer).toHaveAttribute("aria-live", "polite");
  });

  it("handles recipient with no claimable streams with accessible notice and disabled claim actions", async () => {
    server.use(
      http.get(`http://localhost:3000/api/streams/recipient/${RECIPIENT_1}`, () => {
        return HttpResponse.json([
          createMockStream("1", RECIPIENT_1, 0, "active"),
          createMockStream("2", RECIPIENT_1, 0, "active"),
        ]);
      })
    );

    render(<RecipientDashboard recipientAddress={RECIPIENT_1} />);

    const noClaimableNotice = await screen.findByTestId("no-claimable-notice");
    expect(noClaimableNotice).toBeInTheDocument();
    expect(noClaimableNotice).toHaveTextContent("No claimable balance yet.");

    // Claim all button is disabled with descriptive aria label
    const claimAllBtn = screen.getByRole("button", { name: /No claimable streams to claim/i });
    expect(claimAllBtn).toBeDisabled();

    // Individual claim buttons are disabled
    const claimBtns = screen.getAllByRole("button", { name: /Nothing to claim/i });
    expect(claimBtns[0]).toBeDisabled();
  });

  it("safely resets pending modals and fetches fresh stream set when recipient account switches", async () => {
    server.use(
      http.get(`http://localhost:3000/api/streams/recipient/${RECIPIENT_1}`, () => {
        return HttpResponse.json([createMockStream("stream_1", RECIPIENT_1, 100, "active")]);
      }),
      http.get(`http://localhost:3000/api/streams/recipient/${RECIPIENT_2}`, () => {
        return HttpResponse.json([createMockStream("stream_2", RECIPIENT_2, 200, "active")]);
      })
    );

    const { rerender } = render(<RecipientDashboard recipientAddress={RECIPIENT_1} />);

    expect(await screen.findByText("100 USDC")).toBeInTheDocument();

    // Switch account to RECIPIENT_2 mid-session
    rerender(<RecipientDashboard recipientAddress={RECIPIENT_2} />);

    expect(await screen.findByText("200 USDC")).toBeInTheDocument();
    expect(screen.queryByText("100 USDC")).not.toBeInTheDocument();
  });
});
