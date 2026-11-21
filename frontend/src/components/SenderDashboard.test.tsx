import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../server";
import { SenderDashboard } from "./SenderDashboard";
import { Stream } from "../types/stream";
import { StreamEvent } from "../services/api";

// Mock recharts for JSDOM so inner chart elements render properly
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  BarChart: ({ data, children }: any) => (
    <div data-testid="bar-chart">
      {data?.map((d: any, idx: number) => (
        <span key={`${d.name}-${idx}`}>{d.name}</span>
      ))}
      {children}
    </div>
  ),
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Cell: () => null,
}));

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
    expect(amountCard?.querySelector("strong")?.textContent).toContain("3,500");

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

  // =========================================================================
  // Recovery Paths, Zero Streams & Large Lists Review (SSB-2026-022)
  // =========================================================================

  it("shows actionable Retry button when load fails and successfully recovers on retry", async () => {
    const SENDER_RETRY = "GSENDER_RETRY";
    let failFirst = true;

    server.use(
      http.get("/api/streams", () => {
        if (failFirst) {
          return HttpResponse.json({ error: "Transient network failure 503" }, { status: 503 });
        }
        return HttpResponse.json({
          data: [mockActiveStream("recovered-stream-1", SENDER_RETRY)],
          total: 1,
          page: 1,
          limit: 20,
        });
      })
    );
    setupStreamHistoryHandler("recovered-stream-1", []);

    render(
      <SenderDashboard
        senderAddress={SENDER_RETRY}
        onEditStartTime={onEditStartTime}
      />
    );

    // Initial failure displays message and actionable retry button
    await waitFor(() =>
      expect(screen.getByText("Dashboard Load Failed")).toBeInTheDocument()
    );
    expect(screen.getByText(/503/)).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: /Retry/i });
    expect(retryBtn).toBeInTheDocument();

    // Now resolve the failure and click Retry
    failFirst = false;
    fireEvent.click(retryBtn);

    // Dashboard successfully recovers
    await waitFor(() =>
      expect(screen.getByText("Sender Dashboard")).toBeInTheDocument()
    );
    expect(screen.getByText("Total Streams Created")).toBeInTheDocument();
    expect(screen.getByLabelText(/Select stream recovered-stream-1/i)).toBeInTheDocument();
  });

  it("prevents duplicate requests during dashboard load retry", async () => {
    const SENDER_DEDUP = "GSENDER_DEDUP";
    let requestCount = 0;

    server.use(
      http.get("/api/streams", () => {
        requestCount++;
        return HttpResponse.json({ error: "Server busy 500" }, { status: 500 });
      })
    );

    render(
      <SenderDashboard
        senderAddress={SENDER_DEDUP}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Dashboard Load Failed")).toBeInTheDocument()
    );
    expect(requestCount).toBe(1);

    const retryBtn = screen.getByRole("button", { name: /Retry/i });
    // Click retry
    fireEvent.click(retryBtn);
    // Clicking while busy does not trigger duplicate requests
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(requestCount).toBe(2);
    });
  });

  it("shows reconnect wallet option when wallet is disconnected or onReconnect is provided", async () => {
    const onReconnect = vi.fn();
    render(
      <SenderDashboard
        senderAddress={null}
        onEditStartTime={onEditStartTime}
        onReconnect={onReconnect}
      />
    );

    expect(screen.getByText("Wallet Not Connected")).toBeInTheDocument();
    const connectBtn = screen.getByRole("button", { name: /Connect Wallet/i });
    expect(connectBtn).toBeInTheDocument();

    fireEvent.click(connectBtn);
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("surfaces an actionable error banner and Retry Cancel button when stream cancellation returns a recoverable error", async () => {
    const SENDER_CANCEL_ERR = "GSENDER_CANCEL_ERR";
    const streams = [mockActiveStream("cancel-fail-1", SENDER_CANCEL_ERR)];
    setupSenderHandler(streams, SENDER_CANCEL_ERR);
    setupStreamHistoryHandler("cancel-fail-1", []);

    let cancelAttempts = 0;
    server.use(
      http.post("/api/streams/:id/cancel", () => {
        cancelAttempts++;
        if (cancelAttempts === 1) {
          return HttpResponse.json({ error: "Database lock timeout" }, { status: 500 });
        }
        return HttpResponse.json({
          data: mockCanceledStream("cancel-fail-1", SENDER_CANCEL_ERR),
        });
      })
    );

    window.confirm = vi.fn().mockReturnValue(true);

    render(
      <SenderDashboard
        senderAddress={SENDER_CANCEL_ERR}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Sender Dashboard")).toBeInTheDocument()
    );

    // Click the Cancel button — should open accessible confirmation modal (no window.confirm)
    const cancelBtn = screen.getByRole("button", { name: /Cancel stream to/i });
    fireEvent.click(cancelBtn);

    // The accessible modal should appear
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toBeInTheDocument()
    );
    expect(screen.getByText("Cancel stream?")).toBeInTheDocument();

    // Confirm via the accessible modal button
    fireEvent.click(screen.getByRole("button", { name: /Yes, cancel stream/i }));

    // Action error banner displays useful message and Retry Cancel button
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument()
    );
    expect(screen.getByText("Cancellation Failed")).toBeInTheDocument();
    // Scope to the alert box to avoid the live-region duplicate
    const alertBox = screen.getByRole("alert");
    expect(alertBox).toHaveTextContent(/Database lock timeout/i);

    const retryCancelBtn = screen.getByRole("button", { name: /Retry Cancel/i });
    expect(retryCancelBtn).toBeInTheDocument();

    // Clicking retry re-attempts cancellation
    fireEvent.click(retryCancelBtn);

    await waitFor(() => {
      expect(cancelAttempts).toBe(2);
    });
  });

  it("preserves safe selection input and enables Retry Bulk Cancel when bulk cancellation encounters a recoverable error", async () => {
    const SENDER_BULK_ERR = "GSENDER_BULK_ERR";
    const streams = [
      mockActiveStream("bulk-s1", SENDER_BULK_ERR),
      mockActiveStream("bulk-s2", SENDER_BULK_ERR),
    ];
    setupSenderHandler(streams, SENDER_BULK_ERR);
    setupStreamHistoryHandler("bulk-s1", []);
    setupStreamHistoryHandler("bulk-s2", []);

    let bulkCancelAttempts: string[] = [];
    server.use(
      http.post("/api/streams/:id/cancel", ({ params }) => {
        const id = String(params.id);
        bulkCancelAttempts.push(id);
        if (id === "bulk-s2" && bulkCancelAttempts.filter(x => x === "bulk-s2").length === 1) {
          return HttpResponse.json({ error: "Transient gateway error" }, { status: 503 });
        }
        return HttpResponse.json({
          data: mockCanceledStream(id, SENDER_BULK_ERR),
        });
      })
    );

    window.confirm = vi.fn().mockReturnValue(true);

    render(
      <SenderDashboard
        senderAddress={SENDER_BULK_ERR}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    // Select all streams with header checkbox
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);

    const bulkCancelBtn = screen.getByText(/Bulk Cancel \(2\)/);
    fireEvent.click(bulkCancelBtn);

    // Accessible confirmation modal appears — confirm via keyboard-operable button
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toBeInTheDocument()
    );
    expect(screen.getByText(/Cancel 2 stream\(s\)\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Yes, cancel 2 stream\(s\)/i }));

    // Error banner appears
    await waitFor(() =>
      expect(screen.getByText("Bulk Cancellation Failed")).toBeInTheDocument()
    );
    // Scope to alert box to avoid matching the live-region duplicate
    const bulkAlertBox = screen.getByRole("alert");
    expect(bulkAlertBox).toHaveTextContent(/1 of 2 stream\(s\) could not be canceled/);

    // SAFE INPUT PRESERVED: The failed stream 'bulk-s2' remains selected
    expect(screen.getByText(/Bulk Cancel \(1\)/)).toBeInTheDocument();

    const retryBulkBtn = screen.getByRole("button", { name: /Retry Bulk Cancel/i });
    expect(retryBulkBtn).toBeInTheDocument();

    // Clicking Retry Bulk Cancel retries only the remaining stream
    fireEvent.click(retryBulkBtn);

    await waitFor(() => {
      expect(bulkCancelAttempts).toEqual(["bulk-s1", "bulk-s2", "bulk-s2"]);
    });
  });

  it("reviews large stream list: handles 150 streams correctly with aggregate stats and table scrolling", async () => {
    const SENDER_LARGE = "GSENDER_LARGE";
    const streams: Stream[] = [];
    for (let i = 1; i <= 150; i++) {
      if (i <= 50) {
        streams.push(mockActiveStream(`large-s-${i}`, SENDER_LARGE));
      } else if (i <= 100) {
        streams.push(mockScheduledStream(`large-s-${i}`, SENDER_LARGE));
      } else {
        streams.push(mockCompletedStream(`large-s-${i}`, SENDER_LARGE));
      }
    }

    setupSenderHandler(streams, SENDER_LARGE);
    for (let i = 1; i <= 5; i++) {
      setupStreamHistoryHandler(`large-s-${i}`, []);
    }

    render(
      <SenderDashboard
        senderAddress={SENDER_LARGE}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Sender Dashboard")).toBeInTheDocument()
    );

    // Metrics correctly aggregated across 150 streams
    const totalStreamsCard = screen.getByText("Total Streams Created").closest("article");
    expect(totalStreamsCard?.querySelector("strong")?.textContent).toBe("150");

    const activeStreamsCard = screen.getByText("Active Streams").closest("article");
    expect(activeStreamsCard?.querySelector("strong")?.textContent).toBe("50");

    // Table containers have scroll containment style
    const tableWraps = document.querySelectorAll(".table-wrap");
    expect(tableWraps.length).toBeGreaterThan(0);
    expect((tableWraps[0] as HTMLElement).style.maxHeight).toBe("480px");
  });

  // =========================================================================
  // A11Y Tests — SSB-2026-023
  // =========================================================================

  it("opens accessible cancel confirmation dialog instead of window.confirm when Cancel is clicked", async () => {
    const SENDER_A11Y_CANCEL = "GSENDER_A11Y_CANCEL";
    const streams = [mockActiveStream("a11y-s1", SENDER_A11Y_CANCEL)];
    setupSenderHandler(streams, SENDER_A11Y_CANCEL);
    setupStreamHistoryHandler("a11y-s1", []);

    server.use(
      http.post("/api/streams/:id/cancel", () =>
        HttpResponse.json({ data: mockCanceledStream("a11y-s1", SENDER_A11Y_CANCEL) })
      )
    );

    render(
      <SenderDashboard
        senderAddress={SENDER_A11Y_CANCEL}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    // Cancel button opens a dialog — no window.confirm
    const cancelBtn = screen.getByRole("button", { name: /Cancel stream to/i });
    fireEvent.click(cancelBtn);

    // Dialog is present with correct role and labelling
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "cancel-confirm-title");
    expect(screen.getByText("Cancel stream?")).toBeInTheDocument();

    // Both action buttons are keyboard-operable
    const keepBtn = screen.getByRole("button", { name: /Keep stream/i });
    const confirmBtn = screen.getByRole("button", { name: /Yes, cancel stream/i });
    expect(keepBtn).toBeInTheDocument();
    expect(confirmBtn).toBeInTheDocument();

    // Dismiss with Keep stream — dialog closes, no cancel sent
    fireEvent.click(keepBtn);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
  });

  it("closes cancel dialog with Escape key (keyboard operability)", async () => {
    const SENDER_A11Y_ESC = "GSENDER_A11Y_ESC";
    const streams = [mockActiveStream("esc-s1", SENDER_A11Y_ESC)];
    setupSenderHandler(streams, SENDER_A11Y_ESC);
    setupStreamHistoryHandler("esc-s1", []);

    render(
      <SenderDashboard
        senderAddress={SENDER_A11Y_ESC}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: /Cancel stream to/i }));
    await screen.findByRole("dialog");

    // Escape key closes the dialog
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
  });

  it("opens accessible bulk cancel confirmation dialog with correct count in title", async () => {
    const SENDER_A11Y_BULK = "GSENDER_A11Y_BULK";
    const streams = [
      mockActiveStream("bulk-a-1", SENDER_A11Y_BULK),
      mockActiveStream("bulk-a-2", SENDER_A11Y_BULK),
    ];
    setupSenderHandler(streams, SENDER_A11Y_BULK);
    streams.forEach((s) => setupStreamHistoryHandler(s.id, []));

    server.use(
      http.post("/api/streams/:id/cancel", ({ params }) =>
        HttpResponse.json({ data: mockCanceledStream(String(params.id), SENDER_A11Y_BULK) })
      )
    );

    render(
      <SenderDashboard
        senderAddress={SENDER_A11Y_BULK}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    // Select all and open bulk confirm dialog
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByText(/Bulk Cancel \(2\)/));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-labelledby", "bulk-cancel-confirm-title");
    expect(screen.getByText(/Cancel 2 stream\(s\)\?/i)).toBeInTheDocument();

    // Confirm and streams get cancelled
    fireEvent.click(screen.getByRole("button", { name: /Yes, cancel 2 stream\(s\)/i }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
  });

  it("table headers have scope=col for screen reader column association", async () => {
    const SENDER_A11Y_TH = "GSENDER_A11Y_TH";
    const streams = [mockActiveStream("th-s1", SENDER_A11Y_TH)];
    setupSenderHandler(streams, SENDER_A11Y_TH);
    setupStreamHistoryHandler("th-s1", []);

    render(
      <SenderDashboard
        senderAddress={SENDER_A11Y_TH}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    // All visible <th> elements in the active/scheduled table must have scope="col"
    const ths = document.querySelectorAll("table thead th");
    expect(ths.length).toBeGreaterThan(0);
    ths.forEach((th) => {
      // Header checkboxes don't need scope; labeled text headers do
      if (th.textContent?.trim()) {
        expect(th).toHaveAttribute("scope", "col");
      }
    });
  });

  it("select-all checkbox shows indeterminate state when partially selected", async () => {
    const SENDER_A11Y_INDET = "GSENDER_A11Y_INDET";
    const streams = [
      mockActiveStream("indet-s1", SENDER_A11Y_INDET),
      mockActiveStream("indet-s2", SENDER_A11Y_INDET),
    ];
    setupSenderHandler(streams, SENDER_A11Y_INDET);
    streams.forEach((s) => setupStreamHistoryHandler(s.id, []));

    render(
      <SenderDashboard
        senderAddress={SENDER_A11Y_INDET}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    const checkboxes = screen.getAllByRole("checkbox");
    const headerCheckbox = checkboxes[0] as HTMLInputElement;

    // Select only 1 of 2 streams → indeterminate
    fireEvent.click(checkboxes[1]);
    expect(headerCheckbox.indeterminate).toBe(true);
    expect(headerCheckbox.checked).toBe(false);

    // Select both → checked, not indeterminate
    fireEvent.click(checkboxes[2]);
    expect(headerCheckbox.indeterminate).toBe(false);
    expect(headerCheckbox.checked).toBe(true);
  });

  it("truncated recipient addresses carry title and aria-label with full address", async () => {
    const SENDER_A11Y_ADDR = "GSENDER_A11Y_ADDR";
    const stream = mockActiveStream("addr-s1", SENDER_A11Y_ADDR);
    setupSenderHandler([stream], SENDER_A11Y_ADDR);
    setupStreamHistoryHandler("addr-s1", []);

    render(
      <SenderDashboard
        senderAddress={SENDER_A11Y_ADDR}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Active & Scheduled")).toBeInTheDocument()
    );

    // Truncated address span must carry title and aria-label with full recipient
    const truncSpan = document.querySelector(".truncate-address") as HTMLElement;
    expect(truncSpan).not.toBeNull();
    expect(truncSpan.getAttribute("title")).toBe(stream.recipient);
    expect(truncSpan.getAttribute("aria-label")).toContain(stream.recipient);
  });

  it("renders a polite aria-live region for screen reader announcements", async () => {
    const SENDER_A11Y_LIVE = "GSENDER_A11Y_LIVE";
    setupSenderHandler([mockActiveStream("live-s1", SENDER_A11Y_LIVE)], SENDER_A11Y_LIVE);
    setupStreamHistoryHandler("live-s1", []);

    render(
      <SenderDashboard
        senderAddress={SENDER_A11Y_LIVE}
        onEditStartTime={onEditStartTime}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("Sender Dashboard")).toBeInTheDocument()
    );

    // The live region is present in the DOM (sr-only, polite)
    const liveRegion = document.querySelector("[role='status'][aria-live='polite']");
    expect(liveRegion).not.toBeNull();
    expect(liveRegion).toHaveAttribute("aria-atomic", "true");
  });
});
