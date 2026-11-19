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

const SENDER = "GSENDER_BOUNDARY_123";

const createMockStream = (id: string, status: "active" | "scheduled" | "completed"): Stream => ({
  id,
  sender: SENDER,
  recipient: `GRECIPIENT_${id}`,
  assetCode: "USDC",
  totalAmount: 1000,
  durationSeconds: 86400,
  startAt: 1700000000,
  createdAt: 1699990000,
  progress: {
    status,
    ratePerSecond: 0.01157,
    elapsedSeconds: 43200,
    vestedAmount: 500,
    remainingAmount: 500,
    percentComplete: 50,
  },
});

describe("SenderDashboard boundary and volume states (SSB-2026-021)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders explicit zero streams empty state with Create First Stream CTA and no misleading bulk controls", async () => {
    server.use(
      http.get("http://localhost:3000/api/streams", () => {
        return HttpResponse.json({ streams: [] });
      }),
      http.get("http://localhost:3000/api/streams/sender/events", () => {
        return HttpResponse.json({ events: [] });
      })
    );

    render(<SenderDashboard senderAddress={SENDER} onEditStartTime={vi.fn()} />);

    const zeroState = await screen.findByTestId("sender-zero-streams");
    expect(zeroState).toBeInTheDocument();
    expect(screen.getByText("No Streams Found")).toBeInTheDocument();

    const createBtn = screen.getByRole("button", { name: /Create your first stream/i });
    expect(createBtn).toBeInTheDocument();

    // Table and bulk cancel controls are not rendered
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/Bulk Cancel/i)).not.toBeInTheDocument();
  });

  it("displays explicit large volume badge when streams count exceeds threshold", async () => {
    const largeList = Array.from({ length: 55 }, (_, i) =>
      createMockStream(`stream_${i}`, i % 2 === 0 ? "active" : "scheduled")
    );

    server.use(
      http.get("http://localhost:3000/api/streams", () => {
        return HttpResponse.json({ streams: largeList });
      }),
      http.get("http://localhost:3000/api/streams/sender/events", () => {
        return HttpResponse.json({ events: [] });
      })
    );

    render(<SenderDashboard senderAddress={SENDER} onEditStartTime={vi.fn()} />);

    const largeBadge = await screen.findByTestId("large-stream-list-badge");
    expect(largeBadge).toBeInTheDocument();
    expect(largeBadge).toHaveTextContent("Large Volume (55)");

    // Bulk Cancel button is hidden until at least one stream is selected
    expect(screen.queryByText(/Bulk Cancel/i)).not.toBeInTheDocument();
  });

  it("renders recoverable error state with retry button when stream query fails", async () => {
    server.use(
      http.get("http://localhost:3000/api/streams", () => {
        return HttpResponse.json({ error: "Network timeout" }, { status: 500 });
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
    expect(retryBtn).toBeInTheDocument();
  });
});
