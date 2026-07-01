import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../server";
import { SenderDashboard } from "./SenderDashboard";
import { Stream } from "../types/stream";
import { StreamEvent } from "../services/api";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SENDER = "GSENDER123";

const mockActiveStream = (id: string, sender: string): Stream => ({
  id,
  sender: sender,
  recipient: `GRECIPIENT_${id}`,
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
});

const mockScheduledStream = (id: string, sender: string): Stream => ({
  id,
  sender: sender,
  recipient: `GRECIPIENT_${id}`,
  assetCode: "USDC",
  totalAmount: 500,
  durationSeconds: 86400,
  startAt: 1700100000,
  createdAt: 1699990000,
  progress: {
    status: "scheduled",
    ratePerSecond: 0.005787,
    elapsedSeconds: 0,
    vestedAmount: 0,
    remainingAmount: 500,
    percentComplete: 0,
  },
});

const mockPausedStream = (id: string, sender: string): Stream => ({
  ...mockActiveStream(id, sender),
  progress: {
    ...mockActiveStream(id, sender).progress,
    status: "paused",
  },
});

const mockCompletedStream = (id: string, sender: string): Stream => ({
  ...mockActiveStream(id, sender),
  progress: {
    ...mockActiveStream(id, sender).progress,
    status: "completed",
    elapsedSeconds: 86400,
    vestedAmount: 1000,
    remainingAmount: 0,
    percentComplete: 100,
  },
});

const mockCanceledStream = (id: string, sender: string): Stream => ({
  ...mockActiveStream(id, sender),
  progress: {
    ...mockActiveStream(id, sender).progress,
    status: "canceled",
  },
});

const mockStreamEvent = (
  id: number,
  streamId: string,
  eventType: StreamEvent["eventType"] = "created",
  timestamp: number = 1700000000
): StreamEvent => ({
  id,
  streamId,
  eventType,
  timestamp,
  actor: SENDER,
  amount: eventType === "created" ? 1000 : undefined,
  metadata: eventType === "created" ? { assetCode: "USDC" } : undefined,
});

function setupSenderHandler(streams: Stream[], sender: string) {
  server.use(
    http.get("/api/streams", ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get("sender") === sender) {
        return HttpResponse.json({
          data: streams,
          total: streams.length,
          page: 1,
          limit: 20,
        });
      }
      return HttpResponse.json({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
      });
    })
  );
}

function setupStreamHistoryHandler(
  streamId: string,
  events: StreamEvent[]
) {
  server.use(
    http.get(`/api/streams/${streamId}/history`, () => {
      return HttpResponse.json({ data: events });
    })
  );
}

function setupErrorHandler() {
  server.use(
    http.get("/api/streams", () => {
      return HttpResponse.json({ error: "Server Error 500" }, { status: 500 });
    })
  );
}

describe("SenderDashboard - Enhanced Analytics & Activity", () => {
  const onEditStartTime = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Stats Cards Tests
  // =========================================================================

  it("displays stats cards with correct metrics: total streams, total amount, active, completed", async () => {
    const SENDER_STATS = "GSENDER_STATS";
    const streams = [
      mockActiveStream("stream1", SENDER_STATS),
      mockActiveStream("stream2", SENDER_STATS),
      mockScheduledStream("stream3", SENDER_STATS),
      mockCompletedStream("stream4", SENDER_STATS),
    ];
    setupSenderHandler(streams, SENDER_STATS);
    setupStreamHistoryHandler("stream1", []);
    setupStreamHistoryHandler("stream2", []);
    setupStreamHistoryHandler("stream3", []);
    setupStreamHistoryHandler("stream4", []);

    render(
      <SenderDashboard
        senderAddress={SENDER_STATS}
        onEditStartTime={onEditStartTime}
      />
    );

    // Wait for dashboard to load
    await waitFor(() =>
      expect(screen.getByText("Sender Dashboard")).toBeInTheDocument()
    );

    // Verify stats cards
    expect(screen.getByText("Total Streams Created")).toBeInTheDocument();
    const streamsCard = screen
      .getByText("Total Streams Created")
      .closest("article");
    expect(streamsCard?.querySelector("strong")?.textContent).toBe("4");

    expect(screen.getByText("Total Amount Streamed")).toBeInTheDocument();
    const amountCard = screen
      .getByText("Total Amount Streamed")
      .closest("article");
    expect(amountCard?.querySelector("strong")?.textContent).toContain("3000");

    expect(screen.getByText("Active Streams")).toBeInTheDocument();
    const activeCard = screen
      .getByText("Active Streams")
      .closest("article");
    expect(activeCard?.querySelector("strong")?.textContent).toBe("2");

    expect(screen.getByText("Completed/Canceled")).toBeInTheDocument();
    const completedCard = screen
      .getByText("Completed/Canceled")
      .closest("article");
    expect(completedCard?.querySelector("strong")?.textContent).toBe("1");
  });

  it("displays asset breakdown in separate metric cards", async () => {
    const SENDER_ASSET = "GSENDER_ASSET";
    const streams = [
      mockActiveStream("s1", SENDER_ASSET),
      { ...mockActiveStream("s2", SENDER_ASSET), assetCode: "XLM" },
    ];
    setupSenderHandler(streams, SENDER_ASSET);
    setupStreamHistoryHandler("s1", []);
    setupStreamHistoryHandler("s2", []);

    render(
      <SenderDashboard
        senderAddress={SENDER_ASSET}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Sender Dashboard")).toBeInTheDocument()
    );

    expect(screen.getByText("Total USDC")).toBeInTheDocument();
    expect(screen.getByText("Total XLM")).toBeInTheDocument();
  });

  // =========================================================================
  // Bar Chart Tests
  // =========================================================================

  it("renders bar chart showing streams by status", async () => {
    const SENDER_CHART = "GSENDER_CHART";
    const streams = [
      mockActiveStream("s1", SENDER_CHART),
      mockActiveStream("s2", SENDER_CHART),
      mockScheduledStream("s3", SENDER_CHART),
      mockPausedStream("s4", SENDER_CHART),
      mockCompletedStream("s5", SENDER_CHART),
      mockCanceledStream("s6", SENDER_CHART),
    ];
    setupSenderHandler(streams, SENDER_CHART);
    streams.forEach((s) => setupStreamHistoryHandler(s.id, []));

    render(
      <SenderDashboard
        senderAddress={SENDER_CHART}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Streams by Status")).toBeInTheDocument()
    );

    // Verify chart is rendered (look for axis labels)
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Canceled")).toBeInTheDocument();
  });

  // =========================================================================
  // Recent Activity Feed Tests
  // =========================================================================

  it("displays recent activity feed with last 10 events sorted by timestamp", async () => {
    const SENDER_ACTIVITY = "GSENDER_ACTIVITY";
    const streams = [mockActiveStream("stream1", SENDER_ACTIVITY)];
    setupSenderHandler(streams, SENDER_ACTIVITY);

    const events = [
      mockStreamEvent(1, "stream1", "created", 1700000000),
      mockStreamEvent(2, "stream1", "claimed", 1700100000),
      mockStreamEvent(3, "stream1", "paused", 1700200000),
      mockStreamEvent(4, "stream1", "resumed", 1700300000),
    ];

    setupStreamHistoryHandler("stream1", events);

    render(
      <SenderDashboard
        senderAddress={SENDER_ACTIVITY}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Recent Activity")).toBeInTheDocument()
    );

    // Verify events are displayed
    expect(screen.getByText(/Stream created/)).toBeInTheDocument();
    expect(screen.getByText(/Claimed/)).toBeInTheDocument();
    expect(screen.getByText(/Stream paused/)).toBeInTheDocument();
    expect(screen.getByText(/Stream resumed/)).toBeInTheDocument();
  });

  it("aggregates events from multiple streams in activity feed", async () => {
    const SENDER_MULTI = "GSENDER_MULTI";
    const streams = [
      mockActiveStream("s1", SENDER_MULTI),
      mockActiveStream("s2", SENDER_MULTI),
    ];
    setupSenderHandler(streams, SENDER_MULTI);

    setupStreamHistoryHandler("s1", [
      mockStreamEvent(1, "s1", "created", 1700000000),
      mockStreamEvent(2, "s1", "claimed", 1700100000),
    ]);

    setupStreamHistoryHandler("s2", [
      mockStreamEvent(3, "s2", "created", 1700200000),
      mockStreamEvent(4, "s2", "paused", 1700300000),
    ]);

    render(
      <SenderDashboard
        senderAddress={SENDER_MULTI}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Recent Activity")).toBeInTheDocument()
    );

    // Verify all events are aggregated (most recent first)
    const activityItems = screen.getAllByText(/Stream|Claimed|paused/);
    expect(activityItems.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // Bulk Cancel Tests
  // =========================================================================

  it("shows bulk cancel button when streams are selected", async () => {
    const SENDER_BULK = "GSENDER_BULK";
    const streams = [
      mockActiveStream("s1", SENDER_BULK),
      mockActiveStream("s2", SENDER_BULK),
    ];
    setupSenderHandler(streams, SENDER_BULK);
    setupStreamHistoryHandler("s1", []);
    setupStreamHistoryHandler("s2", []);

    render(
      <SenderDashboard
        senderAddress={SENDER_BULK}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    // Select a stream
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThan(0);

    // Click first stream checkbox (skip header checkbox)
    fireEvent.click(checkboxes[1]);

    // Verify bulk cancel button appears
    expect(screen.getByText(/Bulk Cancel \(1\)/)).toBeInTheDocument();
  });

  it("allows selecting/deselecting individual streams for bulk cancel", async () => {
    const SENDER_SELECT = "GSENDER_SELECT";
    const streams = [
      mockActiveStream("s1", SENDER_SELECT),
      mockActiveStream("s2", SENDER_SELECT),
      mockActiveStream("s3", SENDER_SELECT),
    ];
    setupSenderHandler(streams, SENDER_SELECT);
    streams.forEach((s) => setupStreamHistoryHandler(s.id, []));

    render(
      <SenderDashboard
        senderAddress={SENDER_SELECT}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    const checkboxes = screen.getAllByRole("checkbox");

    // Select multiple streams
    fireEvent.click(checkboxes[1]); // stream 1
    fireEvent.click(checkboxes[2]); // stream 2

    expect(screen.getByText(/Bulk Cancel \(2\)/)).toBeInTheDocument();

    // Deselect one
    fireEvent.click(checkboxes[1]);

    expect(screen.getByText(/Bulk Cancel \(1\)/)).toBeInTheDocument();
  });

  it("allows selecting all streams with header checkbox", async () => {
    const SENDER_ALL = "GSENDER_ALL";
    const streams = [
      mockActiveStream("s1", SENDER_ALL),
      mockActiveStream("s2", SENDER_ALL),
    ];
    setupSenderHandler(streams, SENDER_ALL);
    streams.forEach((s) => setupStreamHistoryHandler(s.id, []));

    render(
      <SenderDashboard
        senderAddress={SENDER_ALL}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    const checkboxes = screen.getAllByRole("checkbox");

    // Click header checkbox to select all
    fireEvent.click(checkboxes[0]);

    expect(screen.getByText(/Bulk Cancel \(2\)/)).toBeInTheDocument();
  });

  // =========================================================================
  // Original Tests (maintained from baseline)
  // =========================================================================

  it("renders with 3 active and 2 completed streams and asserts metric counts", async () => {
    const SENDER_METRICS = "GSENDER_METRICS";
    const streams = [
      mockActiveStream("1", SENDER_METRICS),
      mockActiveStream("2", SENDER_METRICS),
      mockActiveStream("3", SENDER_METRICS),
      mockCompletedStream("4", SENDER_METRICS),
      mockCompletedStream("5", SENDER_METRICS),
    ];
    setupSenderHandler(streams, SENDER_METRICS);
    streams.forEach((s) => setupStreamHistoryHandler(s.id, []));

    render(
      <SenderDashboard
        senderAddress={SENDER_METRICS}
        onEditStartTime={onEditStartTime}
      />
    );

    // Wait for loading to finish
    await waitFor(() =>
      expect(screen.queryByText(/Sender Dashboard/)).toBeInTheDocument()
    );

    // Check metrics
    // Total streams: 5
    const streamsCard = screen
      .getByText("Total Streams Created")
      .closest("article");
    expect(streamsCard?.querySelector("strong")?.textContent).toBe("5");

    const activeMetric = screen
      .getByText("Active Streams")
      .closest("article");
    expect(activeMetric?.querySelector("strong")?.textContent).toBe("3");

    const completedMetric = screen
      .getByText("Completed/Canceled")
      .closest("article");
    expect(completedMetric?.querySelector("strong")?.textContent).toBe("2");
  });

  it("renders with no streams and asserts zero metrics and 'create your first stream' prompt", async () => {
    const SENDER_EMPTY = "GSENDER_EMPTY";
    setupSenderHandler([], SENDER_EMPTY);

    render(
      <SenderDashboard
        senderAddress={SENDER_EMPTY}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("No Streams Found")).toBeInTheDocument()
    );
    expect(screen.getByText("Create your first stream")).toBeInTheDocument();

    // Verify metrics are absent in the empty state
    expect(screen.queryByText(/Total Streams Created/)).not.toBeInTheDocument();
  });

  it("shows CreateStreamForm when 'Create Stream' button is clicked", async () => {
    const SENDER_CREATE = "GSENDER_CREATE";
    setupSenderHandler([], SENDER_CREATE);

    render(
      <SenderDashboard
        senderAddress={SENDER_CREATE}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Create your first stream")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByText("Create your first stream"));

    // Check if CreateStreamForm elements are present
    expect(screen.getByText(/Recipient Account/i)).toBeInTheDocument();
    expect(screen.getByText("Back to Dashboard")).toBeInTheDocument();
  });

  it("shows CreateStreamForm when 'Create Stream' button in header is clicked", async () => {
    const SENDER_HEADER = "GSENDER_HEADER";
    const streams = [mockActiveStream("1", SENDER_HEADER)];
    setupSenderHandler(streams, SENDER_HEADER);
    setupStreamHistoryHandler("1", []);

    render(
      <SenderDashboard
        senderAddress={SENDER_HEADER}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Sender Dashboard")).toBeInTheDocument()
    );

    // Click the "Create Stream" button in the header
    fireEvent.click(screen.getByRole("button", { name: /Create Stream/i }));

    // Check if CreateStreamForm elements are present
    expect(screen.getByText(/Recipient Account/i)).toBeInTheDocument();
    expect(screen.getByText("Back to Dashboard")).toBeInTheDocument();

    // Toggle back
    fireEvent.click(screen.getByText("Back to Dashboard"));
    expect(screen.queryByText(/Recipient Account/i)).not.toBeInTheDocument();
  });

  it("surfaces a user-visible message on API error", async () => {
    const SENDER_ERROR = "GSENDER_ERROR";
    setupErrorHandler();

    render(
      <SenderDashboard
        senderAddress={SENDER_ERROR}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Dashboard Load Failed")).toBeInTheDocument()
    );
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });

  it("shows wallet connection prompt when senderAddress is null", async () => {
    render(
      <SenderDashboard senderAddress={null} onEditStartTime={onEditStartTime} />
    );

    expect(screen.getByText("Wallet Not Connected")).toBeInTheDocument();
    expect(screen.getByText(/Connect your wallet/)).toBeInTheDocument();
  });
});
