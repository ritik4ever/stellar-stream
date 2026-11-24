import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamsTable } from "../../src/components/StreamsTable";
import type { Stream } from "../../src/types/stream";

const MOCK_STREAMS: Stream[] = [
  {
    id: "stream-1",
    sender: "GSENDER1234567890123456789012345678901234567890123456789",
    recipient: "GRECIPIENT123456789012345678901234567890123456789012345",
    assetCode: "USDC",
    totalAmount: 1000,
    durationSeconds: 86400,
    startAt: 1700000000,
    createdAt: 1699990000,
    progress: {
      status: "active",
      ratePerSecond: 0.011574,
      elapsedSeconds: 43200,
      vestedAmount: 500,
      remainingAmount: 500,
      percentComplete: 50,
    },
  },
  {
    id: "stream-2",
    sender: "GSENDER1234567890123456789012345678901234567890123456789",
    recipient: "GRECIPIENT223456789012345678901234567890123456789012345",
    assetCode: "XLM",
    totalAmount: 250,
    durationSeconds: 3600,
    startAt: 1700010000,
    createdAt: 1700005000,
    progress: {
      status: "completed",
      ratePerSecond: 0.069444,
      elapsedSeconds: 3600,
      vestedAmount: 250,
      remainingAmount: 0,
      percentComplete: 100,
    },
  },
];

describe("StreamsTable snapshots", () => {
  let toLocaleStringSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    toLocaleStringSpy = vi
      .spyOn(Date.prototype, "toLocaleString")
      .mockImplementation(function (this: Date) {
        return this.toISOString();
      });
  });

  afterEach(() => {
    toLocaleStringSpy.mockRestore();
  });

  it("matches snapshot with active and completed streams", () => {
    const { container } = render(
      <StreamsTable
        streams={MOCK_STREAMS}
        filters={{}}
        onFiltersChange={vi.fn()}
        onCancel={vi.fn().mockResolvedValue(undefined)}
        onPause={vi.fn().mockResolvedValue(undefined)}
        onResume={vi.fn().mockResolvedValue(undefined)}
        onEditStartTime={vi.fn()}
        hasMore={false}
      />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot when empty", () => {
    const { container } = render(
      <StreamsTable
        streams={[]}
        filters={{}}
        onFiltersChange={vi.fn()}
        onCancel={vi.fn().mockResolvedValue(undefined)}
        onPause={vi.fn().mockResolvedValue(undefined)}
        onResume={vi.fn().mockResolvedValue(undefined)}
        onEditStartTime={vi.fn()}
        hasMore={false}
      />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot while loading", async () => {
    const { container } = render(
      <StreamsTable
        streams={[]}
        loading={true}
        filters={{}}
        onFiltersChange={vi.fn()}
        onCancel={vi.fn().mockResolvedValue(undefined)}
        onPause={vi.fn().mockResolvedValue(undefined)}
        onResume={vi.fn().mockResolvedValue(undefined)}
        onEditStartTime={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(container.firstChild).toMatchSnapshot();
    });
  });
});
