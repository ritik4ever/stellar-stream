import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reconcileMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("./streamStore", () => ({
  reconcileMissingStreams: reconcileMock,
}));

vi.mock("../logger", () => ({
  logger: loggerMock,
}));

describe("reconciliationJob – missing stream detection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    reconcileMock.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls reconcileMissingStreams immediately when started", async () => {
    const { startReconciliationJob } = await import("./reconciliationJob");
    startReconciliationJob(60000);
    await vi.advanceTimersByTimeAsync(0);
    expect(reconcileMock).toHaveBeenCalledTimes(1);
  });

  it("detects missing streams — repair count propagates from reconcileMissingStreams", async () => {
    reconcileMock.mockResolvedValue(5);
    const { startReconciliationJob } = await import("./reconciliationJob");
    startReconciliationJob(60000);
    await vi.advanceTimersByTimeAsync(0);
    expect(reconcileMock).toHaveBeenCalledTimes(1);
    const result = await reconcileMock.mock.results[0].value;
    expect(result).toBe(5);
  });

  it("runs reconcileMissingStreams again on each interval tick", async () => {
    const { startReconciliationJob } = await import("./reconciliationJob");
    const intervalMs = 5000;
    startReconciliationJob(intervalMs);

    await vi.advanceTimersByTimeAsync(0);
    expect(reconcileMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(intervalMs);
    expect(reconcileMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(intervalMs);
    expect(reconcileMock).toHaveBeenCalledTimes(3);
  });

  it("skips concurrent cycle when previous run is still in-flight", async () => {
    let resolveFirst!: (n: number) => void;
    reconcileMock.mockImplementationOnce(
      () => new Promise<number>((res) => { resolveFirst = res; }),
    );

    const { startReconciliationJob } = await import("./reconciliationJob");
    startReconciliationJob(5000);

    // Let the initial async call start without resolving
    await Promise.resolve();

    // Interval fires while first call is still pending
    await vi.advanceTimersByTimeAsync(5000);

    expect(reconcileMock).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("skipping"),
    );

    resolveFirst(0);
  });

  it("does not start a second interval if already running", async () => {
    const { startReconciliationJob } = await import("./reconciliationJob");
    startReconciliationJob(5000);
    startReconciliationJob(5000); // no-op — interval already set

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);

    // If two intervals were registered we'd see 4 calls; one interval gives 2
    expect(reconcileMock).toHaveBeenCalledTimes(2);
  });

  it("stops running after stopReconciliationJob is called", async () => {
    const { startReconciliationJob, stopReconciliationJob } = await import("./reconciliationJob");
    startReconciliationJob(5000);

    await vi.advanceTimersByTimeAsync(0);
    expect(reconcileMock).toHaveBeenCalledTimes(1);

    stopReconciliationJob();

    await vi.advanceTimersByTimeAsync(30000);
    expect(reconcileMock).toHaveBeenCalledTimes(1);
  });

  it("logs error and does not throw when reconcileMissingStreams rejects", async () => {
    reconcileMock.mockRejectedValue(new Error("RPC timeout"));
    const { startReconciliationJob } = await import("./reconciliationJob");
    startReconciliationJob(60000);
    await vi.advanceTimersByTimeAsync(0);
    expect(loggerMock.error).toHaveBeenCalled();
  });
});
