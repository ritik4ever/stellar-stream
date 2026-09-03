import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamsTable } from "./StreamsTable";
import type { Stream } from "../types/stream";

const noop = vi.fn().mockResolvedValue(undefined);

function createStream(id: string, status: Stream["progress"]["status"]): Stream {
  return {
    id,
    sender: `G_SENDER_${id}`,
    recipient: `G_RECIPIENT_${id}`,
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

function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe("StreamsTable CSV export", () => {
  let exportedBlob: Blob | undefined;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 28, 12, 0, 0));

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        exportedBlob = blob;
        return "blob:streams-csv";
      }),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });

    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("downloads the current filtered stream list with the required columns and filename", async () => {
    const filteredStreams = [createStream("2", "active")];

    render(
      <StreamsTable
        streams={filteredStreams}
        filters={{ status: "active" }}
        onFiltersChange={vi.fn()}
        onCancel={noop}
        onPause={noop}
        onResume={noop}
        onEditStartTime={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const downloadAnchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(downloadAnchor.download).toBe("streams_2026-08-28.csv");
    expect(downloadAnchor.href).toContain("blob:streams-csv");

    expect(exportedBlob).toBeDefined();
    const csv = await readBlobAsText(exportedBlob!);

    expect(csv).toBe(
      [
        "id,sender,recipient,asset,amount,vested,status,start,duration",
        "2,G_SENDER_2,G_RECIPIENT_2,USDC,100,20,active,1670000000,3600",
      ].join("\n"),
    );
    expect(csv).not.toContain("G_SENDER_1");
  });
});
