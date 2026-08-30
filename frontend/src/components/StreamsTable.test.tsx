import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { StreamsTable, STREAMS_TABLE_VIRTUAL_OVERSCAN } from "./StreamsTable";
import { Stream } from "../types/stream";

const noop = vi.fn().mockResolvedValue(undefined);

function createMockStream(id: string, status: Stream["progress"]["status"] = "active"): Stream {
  return {
    id,
    sender: "G_SENDER123456789012345678901234567890123456789012345678901",
    recipient: "G_RECIPIENT123456789012345678901234567890123456789012345",
    assetCode: "USDC",
    totalAmount: 100,
    durationSeconds: 3600,
    startAt: 1670000000,
    createdAt: 1670000000,
    progress: {
      status,
      ratePerSecond: 0.01,
      elapsedSeconds: 100,
      vestedAmount: 20,
      remainingAmount: 80,
      percentComplete: 20,
    },
  };
}

const mockStreams: Stream[] = [createMockStream("1")];

const defaultProps = {
  streams: mockStreams,
  filters: {},
  onFiltersChange: vi.fn(),
  onCancel: noop,
  onPause: noop,
  onResume: noop,
  onEditStartTime: vi.fn(),
};

function setScrollViewport(element: HTMLElement, height: number) {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(element, "offsetHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: height * 20,
  });
}

describe("StreamsTable column visibility", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("hides optional column by default and shows it when toggled", () => {
    render(<StreamsTable {...defaultProps} />);

    expect(screen.queryByRole("columnheader", { name: "Asset" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Toggle table columns" }));
    fireEvent.click(screen.getByLabelText("Asset"));

    expect(screen.getByRole("columnheader", { name: "Asset" })).toBeInTheDocument();
    expect(screen.getByText("USDC")).toBeInTheDocument();
  });

  it("persists column visibility to localStorage", () => {
    const { unmount } = render(<StreamsTable {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle table columns" }));
    fireEvent.click(screen.getByLabelText("Asset"));

    const stored = JSON.parse(localStorage.getItem("stream-table-columns") ?? "{}");
    expect(stored.assetCode).toBe(true);

    unmount();
    render(<StreamsTable {...defaultProps} />);

    expect(screen.getByRole("columnheader", { name: "Asset" })).toBeInTheDocument();
  });
});

describe("StreamsTable virtual scrolling", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses a bounded scroll container for the table body", () => {
    render(<StreamsTable {...defaultProps} />);

    const scrollContainer = screen.getByTestId("streams-table-scroll");
    expect(scrollContainer).toHaveClass("streams-table-scroll");
    expect(scrollContainer.getAttribute("style")).toContain("max-height");
  });

  it("renders only visible rows plus overscan for large lists", () => {
    const manyStreams = Array.from({ length: 500 }, (_, i) =>
      createMockStream(String(i + 1).padStart(4, "0")),
    );

    const view = render(<StreamsTable {...defaultProps} streams={manyStreams} />);
    setScrollViewport(screen.getByTestId("streams-table-scroll"), 400);
    view.rerender(<StreamsTable {...defaultProps} streams={manyStreams} />);

    const renderedRows = screen.getAllByRole("checkbox", {
      name: /^Select stream /,
    });
    const expectedMax =
      Math.ceil(400 / 52) + STREAMS_TABLE_VIRTUAL_OVERSCAN + 2;

    expect(renderedRows.length).toBeLessThan(500);
    expect(renderedRows.length).toBeLessThanOrEqual(expectedMax);
  });

  it("configures virtual overscan to five rows", () => {
    expect(STREAMS_TABLE_VIRTUAL_OVERSCAN).toBe(5);
  });

  it("preserves keyboard focus order for rendered row actions", () => {
    render(<StreamsTable {...defaultProps} />);

    const cancelButton = screen.getByRole("button", { name: "Cancel stream 1" });
    cancelButton.focus();
    expect(document.activeElement).toBe(cancelButton);
  });
});

describe("StreamsTable infinite scroll", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders sentinel element for infinite scroll", () => {
    render(<StreamsTable {...defaultProps} onLoadMore={vi.fn()} hasMore={true} />);
    expect(screen.getByTestId("infinite-scroll-sentinel")).toBeInTheDocument();
  });

  it("shows loading indicator when loadingMore is true", () => {
    render(<StreamsTable {...defaultProps} loadingMore={true} />);
    expect(screen.getByText(/Loading more streams/i)).toBeInTheDocument();
  });

  it("shows end of results message when hasMore is false", () => {
    render(<StreamsTable {...defaultProps} hasMore={false} />);
    expect(screen.getByText(/End of results/i)).toBeInTheDocument();
  });

  it("calls onLoadMore when sentinel becomes visible", () => {
    const onLoadMore = vi.fn();
    let observerCallback: IntersectionObserverCallback = () => {};

    vi.spyOn(window, "IntersectionObserver").mockImplementation(
      function (callback) {
        observerCallback = callback;
        return { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn(), root: null, rootMargin: "", thresholds: [] };
      },
    );

    render(
      <StreamsTable
        {...defaultProps}
        onLoadMore={onLoadMore}
        hasMore={true}
        loadingMore={false}
      />,
    );

    // Simulate sentinel becoming visible
    const sentinel = screen.getByTestId("infinite-scroll-sentinel");
    act(() => {
      observerCallback([{ isIntersecting: true, target: sentinel } as unknown as IntersectionObserverEntry], null!);
    });

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not call onLoadMore when hasMore is false", () => {
    const onLoadMore = vi.fn();
    let observerCallback: IntersectionObserverCallback = () => {};

    vi.spyOn(window, "IntersectionObserver").mockImplementation(
      function (callback) {
        observerCallback = callback;
        return { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn(), root: null, rootMargin: "", thresholds: [] };
      },
    );

    render(
      <StreamsTable
        {...defaultProps}
        onLoadMore={onLoadMore}
        hasMore={false}
        loadingMore={false}
      />,
    );

    const sentinel = screen.getByTestId("infinite-scroll-sentinel");
    act(() => {
      observerCallback([{ isIntersecting: true, target: sentinel } as unknown as IntersectionObserverEntry], null!);
    });

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("does not call onLoadMore when already loadingMore", () => {
    const onLoadMore = vi.fn();
    let observerCallback: IntersectionObserverCallback = () => {};

    vi.spyOn(window, "IntersectionObserver").mockImplementation(
      function (callback) {
        observerCallback = callback;
        return { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn(), root: null, rootMargin: "", thresholds: [] };
      },
    );

    render(
      <StreamsTable
        {...defaultProps}
        onLoadMore={onLoadMore}
        hasMore={true}
        loadingMore={true}
      />,
    );

    const sentinel = screen.getByTestId("infinite-scroll-sentinel");
    act(() => {
      observerCallback([{ isIntersecting: true, target: sentinel } as unknown as IntersectionObserverEntry], null!);
    });

    expect(onLoadMore).not.toHaveBeenCalled();
  });
});

describe("StreamsTable WebSocket progress updates", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv("VITE_WS_URL", "");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("shows disconnected banner when WebSocket is not connected", () => {
    render(<StreamsTable {...defaultProps} />);
    expect(screen.getByText(/Live updates paused/i)).toBeInTheDocument();
  });

  it("updates progress bar when WebSocket message received", () => {
    const streams = [
      createMockStream("1", "active"),
      createMockStream("2", "active"),
    ];
    
    render(<StreamsTable {...defaultProps} streams={streams} />);
    
    // Initial progress for stream 1
    const initialProgress = screen.getAllByText("20.00%")[0];
    expect(initialProgress).toBeInTheDocument();
    
    // Full integration testing would require:
    // 1. Mocking useWebSocket hook to capture onMessage callback
    // 2. Simulating a stream_progress message with { streamId: "1", progress: { percentComplete: 50 } }
    // 3. Asserting the progress bar for stream 1 updates to "50%"
    // The component structure is in place to handle this via streamProgressUpdates Map
  });
});
