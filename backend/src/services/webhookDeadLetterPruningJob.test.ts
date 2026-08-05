import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pruneMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("./webhook", () => ({ pruneDeadLettersOlderThan: pruneMock }));
vi.mock("../logger", () => ({ logger: loggerMock }));

import {
  DEAD_LETTER_RETENTION_SECONDS,
  runDeadLetterPruningCycle,
  startDeadLetterPruningJob,
  stopDeadLetterPruningJob,
} from "./webhookDeadLetterPruningJob";

describe("webhook dead-letter pruning job", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    pruneMock.mockReturnValue(0);
  });

  afterEach(() => {
    stopDeadLetterPruningJob();
    vi.useRealTimers();
  });

  it("prunes entries older than 30 days", () => {
    const now = 4_000_000;
    pruneMock.mockReturnValue(3);

    expect(runDeadLetterPruningCycle(now)).toBe(3);
    expect(pruneMock).toHaveBeenCalledWith(now - DEAD_LETTER_RETENTION_SECONDS);
  });

  it("runs immediately and at the configured interval", () => {
    startDeadLetterPruningJob(60_000);
    expect(pruneMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(120_000);
    expect(pruneMock).toHaveBeenCalledTimes(3);
  });

  it("logs failures and continues scheduling future cycles", () => {
    pruneMock.mockImplementationOnce(() => { throw new Error("database busy"); });
    startDeadLetterPruningJob(60_000);
    expect(loggerMock.error).toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(pruneMock).toHaveBeenCalledTimes(2);
  });
});