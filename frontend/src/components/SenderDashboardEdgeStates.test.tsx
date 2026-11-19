import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../server";
import { SenderDashboard } from "./SenderDashboard";
import { Stream } from "../types/stream";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  BarChart: ({ children }: any) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Cell: () => null,
}));

const SENDER = "GSENDER_EDGE_STATES_967";

const createMockStream = (id: string, status: "active" | "scheduled" | "completed"): Stream => ({
  id,
  sender: SENDER,
  recipient: `GRECIPIENT_${id}`,
  assetCode: "USDC",
  totalAmount: 500,
  durationSeconds: 86400,
  startAt: 1700000000,
  createdAt: 1699990000,
  progress: {
    status,
    ratePerSecond: 0.005,
    elapsedSeconds: 43200,
    vestedAmount: 250,
    remainingAmount: 250,
    percentComplete: 50,
  },
});

describe("SenderDashboard edge and failure states (SSB-2026-025)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifies visible zero streams empty state and omission of ready-to-act controls", async () => {
    server.use(
      http.get("http://localhost:3000/api/streams", () => {
        return HttpResponse.json({ streams: [] });
      }),
      http.get("http://localhost:3000/api/streams/sender/events", () => {
        return HttpResponse.json({ events: [] });
      })
    );

    render(<SenderDashboard senderAddress={SENDER} onEditStartTime={vi.fn()} />);

    const zeroContainer = await screen.findByTestId("sender-zero-streams");
    expect(zeroContainer).toBeInTheDocument();
    expect(screen.getByText("No Streams Found")).toBeInTheDocument();

    // Verify safe action: only Create CTA exists, no table or bulk controls
    expect(screen.getByRole("button", { name: /Create your first stream/i })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/Bulk Cancel/i)).not.toBeInTheDocument();
  });

  it("verifies bounded layout and large volume badge with safe action gating for 75 streams", async () => {
    const streamBatch = Array.from({ length: 75 }, (_, i) =>
      createMockStream(`edge_stream_${i}`, i % 3 === 0 ? "active" : "scheduled")
    );

    server.use(
      http.get("http://localhost:3000/api/streams", () => {
        return HttpResponse.json({ streams: streamBatch });
      }),
      http.get("http://localhost:3000/api/streams/sender/events", () => {
        return HttpResponse.json({ events: [] });
      })
    );

    render(<SenderDashboard senderAddress={SENDER} onEditStartTime={vi.fn()} />);

    const badge = await screen.findByTestId("large-stream-list-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Large Volume (75)");

    // Safe action: Bulk Cancel button must not be visible before checking rows
    expect(screen.queryByText(/Bulk Cancel/i)).not.toBeInTheDocument();

    // Select one row and verify button becomes active
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]); // select first individual stream

    const bulkBtn = await screen.findByRole("button", { name: /Bulk Cancel \(1\)/i });
    expect(bulkBtn).toBeInTheDocument();
  });

  it("verifies recoverable error alert and re-fetch execution on Retry click", async () => {
    let callCount = 0;
    server.use(
      http.get("http://localhost:3000/api/streams", () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json({ error: "Service Unavailable" }, { status: 503 });
        }
        return HttpResponse.json({ streams: [createMockStream("recovered_1", "active")] });
      }),
      http.get("http://localhost:3000/api/streams/sender/events", () => {
        return HttpResponse.json({ events: [] });
      })
    );

    render(<SenderDashboard senderAddress={SENDER} onEditStartTime={vi.fn()} />);

    const errorAlert = await screen.findByRole("alert");
    expect(errorAlert).toBeInTheDocument();
    expect(screen.getByText("Dashboard Load Failed")).toBeInTheDocument();

    const retryBtn = screen.getByRole("button", { name: /^Retry$/i });
    fireEvent.click(retryBtn);

    // Verify recovery after retry
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    expect(await screen.findByText("Active & Scheduled")).toBeInTheDocument();
  });
});
