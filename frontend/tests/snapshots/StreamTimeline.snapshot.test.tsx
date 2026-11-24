import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamTimeline } from "../../src/components/StreamTimeline";
import { getStreamHistory, listAllEvents, type StreamEvent } from "../../src/services/api";

vi.mock("../../src/services/api", () => ({
  getStreamHistory: vi.fn(),
  listAllEvents: vi.fn(),
}));

const MOCK_EVENTS: StreamEvent[] = [
  {
    id: 1,
    streamId: "stream-snap-1",
    eventType: "created",
    timestamp: 1700000000,
    actor: "GSENDER1234567890123456789012345678901234567890123456789",
    amount: 1000,
  },
  {
    id: 2,
    streamId: "stream-snap-1",
    eventType: "claimed",
    timestamp: 1700003600,
    actor: "GRECIPIENT123456789012345678901234567890123456789012345",
    amount: 250,
  },
  {
    id: 3,
    streamId: "stream-snap-1",
    eventType: "paused",
    timestamp: 1700007200,
    actor: "GSENDER1234567890123456789012345678901234567890123456789",
  },
];

describe("StreamTimeline snapshots", () => {
  let toLocaleStringSpy: ReturnType<typeof vi.spyOn>;
  let dateNowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    toLocaleStringSpy = vi
      .spyOn(Date.prototype, "toLocaleString")
      .mockImplementation(function (this: Date) {
        return this.toISOString();
      });
    dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1700010000000);
  });

  afterEach(() => {
    toLocaleStringSpy.mockRestore();
    dateNowSpy.mockRestore();
  });

  it("matches snapshot for stream history events", async () => {
    vi.mocked(getStreamHistory).mockResolvedValue(MOCK_EVENTS);

    const { container } = render(<StreamTimeline streamId="stream-snap-1" />);
    await waitFor(() => {
      expect(screen.queryByTestId("timeline-loading-state")).not.toBeInTheDocument();
    });
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot for empty global event feed", async () => {
    vi.mocked(listAllEvents).mockResolvedValue([]);

    const { container } = render(<StreamTimeline />);
    await waitFor(() => {
      expect(screen.queryByTestId("timeline-loading-state")).not.toBeInTheDocument();
    });
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot for error state", async () => {
    vi.mocked(getStreamHistory).mockRejectedValue(new Error("Network error"));

    const { container } = render(<StreamTimeline streamId="stream-snap-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("timeline-error-state")).toBeInTheDocument();
    });
    expect(container.firstChild).toMatchSnapshot();
  });
});
