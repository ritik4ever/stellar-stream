import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListStreamsFilters, PaginatedResult } from "../services/api";
import type { Stream } from "../types/stream";
import { DashboardPage } from "./DashboardPage";

const { listStreamsMock, showToastMock } = vi.hoisted(() => ({
  listStreamsMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock("../services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api")>();
  return {
    ...actual,
    listStreams: listStreamsMock,
    listOpenIssues: vi.fn().mockResolvedValue([]),
    createStream: vi.fn(),
    cancelStream: vi.fn(),
    pauseStream: vi.fn(),
    resumeStream: vi.fn(),
    updateStreamStartAt: vi.fn(),
  };
});

vi.mock("../hooks/useFreighter", () => ({
  useFreighter: () => ({
    installed: false,
    allowed: false,
    address: null,
    status: "idle",
    error: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signAction: vi.fn(),
  }),
}));

vi.mock("../hooks/useMetricsHistory", () => ({
  useMetricsHistory: () => ({ data: [], loading: false, error: null }),
}));

vi.mock("../hooks/useToast", () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

vi.mock("../hooks/useWebSocket", () => ({
  useWebSocket: () => ({ readyState: 0, lastMessage: null }),
}));

vi.mock("../components/CreateStreamForm", () => ({ CreateStreamForm: () => null }));
vi.mock("../components/EditStartTimeModal", () => ({ EditStartTimeModal: () => null }));
vi.mock("../components/IssueBacklog", () => ({ IssueBacklog: () => null }));
vi.mock("../components/StreamDetailDrawer", () => ({ StreamDetailDrawer: () => null }));
vi.mock("../components/StreamMetricsChart", () => ({ StreamMetricsChart: () => null }));
vi.mock("../components/StreamTimeline", () => ({ StreamTimeline: () => null }));
vi.mock("../components/StatsPanel", () => ({ StatsPanel: () => null }));
vi.mock("../components/StreamsTable", async () => {
  const { FilterBar } = await import("../components/FilterBar");
  return {
    StreamsTable: ({
      filters,
      onFiltersChange,
      streams,
      loading,
      loadError,
      onRetryLoad,
    }: {
      filters: ListStreamsFilters;
      onFiltersChange: (filters: ListStreamsFilters) => void;
      streams: Stream[];
      loading: boolean;
      loadError?: string | null;
      onRetryLoad?: () => void;
    }) => (
      <div>
        <FilterBar filters={filters} onChange={onFiltersChange} />
        {loading && <span>Loading streams</span>}
        {loadError && (
          <div role="alert">
            <p>{loadError}</p>
            <button type="button" onClick={onRetryLoad} disabled={loading}>
              Retry
            </button>
          </div>
        )}
        {streams.map((stream) => (
          <div key={stream.id}>{stream.id}</div>
        ))}
      </div>
    ),
  };
});

function makeStream(id: string): Stream {
  return {
    id,
    sender: "G_SENDER",
    recipient: "G_RECIPIENT",
    assetCode: "USDC",
    totalAmount: 100,
    durationSeconds: 3600,
    startAt: 1000,
    createdAt: 900,
    progress: {
      status: "active",
      ratePerSecond: 1,
      elapsedSeconds: 100,
      vestedAmount: 10,
      remainingAmount: 90,
      percentComplete: 10,
    },
  };
}

function result(ids: string[]): PaginatedResult<Stream> {
  return {
    data: ids.map(makeStream),
    total: ids.length,
    page: 1,
    limit: 20,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderDashboard() {
  return render(
    <DashboardPage
      wallet={{
        installed: false,
        allowed: false,
        address: null,
        status: "idle",
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        signAction: vi.fn(),
      }}
    />,
  );
}

describe("Dashboard stream search recovery", () => {
  beforeEach(() => {
    listStreamsMock.mockReset();
    listStreamsMock.mockResolvedValue(result([]));
    window.history.replaceState(null, "", "/");
  });

  it("ignores a slow response for an older query", async () => {
    const oldResponse = deferred<PaginatedResult<Stream>>();
    listStreamsMock.mockImplementation((filters?: ListStreamsFilters) => {
      if (filters?.q === "older") return oldResponse.promise;
      if (filters?.q === "newer") return Promise.resolve(result(["newer-result"]));
      return Promise.resolve(result([]));
    });

    renderDashboard();
    const input = await screen.findByLabelText(/Search ID \/ Address/i);

    fireEvent.change(input, { target: { value: "older", name: "q" } });
    await waitFor(() =>
      expect(listStreamsMock).toHaveBeenCalledWith(
        expect.objectContaining({ q: "older", limit: 20 }),
      ),
    );

    fireEvent.change(input, { target: { value: "newer", name: "q" } });
    await screen.findByText("newer-result");

    oldResponse.resolve(result(["older-result"]));
    await waitFor(() => expect(listStreamsMock).toHaveBeenCalledTimes(4));
    expect(screen.getByText("newer-result")).toBeInTheDocument();
    expect(screen.queryByText("older-result")).not.toBeInTheDocument();
  });

  it("retains the query and retries a failed search only once", async () => {
    let searchAttempts = 0;
    listStreamsMock.mockImplementation((filters?: ListStreamsFilters) => {
      if (filters?.q === "safe query" && searchAttempts++ === 0) {
        return Promise.reject(new Error("network unavailable"));
      }
      return Promise.resolve(result([]));
    });

    renderDashboard();
    const input = await screen.findByLabelText(/Search ID \/ Address/i);
    fireEvent.change(input, { target: { value: "safe query", name: "q" } });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Check your connection and retry.",
    );
    expect(input).toHaveValue("safe query");

    const retry = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    fireEvent.click(retry);

    await waitFor(() =>
      expect(
        listStreamsMock.mock.calls.filter(([filters]) => filters?.q === "safe query"),
      ).toHaveLength(2),
    );
    expect(input).toHaveValue("safe query");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
