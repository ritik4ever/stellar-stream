import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyStreamProgressOutcome,
  evaluateStreamProgressClockSkew,
  getLastObservedProgressAt,
  getLastStreamProgressSignal,
  resetStreamProgressOutcome,
  STREAM_PROGRESS_OUTCOME_CODES,
  CLOCK_SKEW_TRANSIENT_THRESHOLD_SECONDS,
} from "./streamProgressOutcome";
import type { StreamRecord } from "./streamStore";
import { logger } from "../logger";

describe("streamProgressOutcome", () => {
  const baseStream: StreamRecord = {
    id: "test-stream-1",
    sender: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    recipient: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    assetCode: "USDC",
    totalAmount: 500,
    durationSeconds: 1000,
    startAt: 1000000,
    createdAt: 999000,
    pausedDuration: 0,
    cliffSeconds: 0,
  };

  beforeEach(() => {
    resetStreamProgressOutcome();
  });

  describe("classifyStreamProgressOutcome", () => {
    it("reports success and isNormalEmpty: true for a stream before startAt", () => {
      const signal = classifyStreamProgressOutcome(baseStream, 999500);
      expect(signal.outcome).toBe("success");
      expect(signal.outcomeCode).toBe(STREAM_PROGRESS_OUTCOME_CODES.success);
      expect(signal.isNormalEmpty).toBe(true);
      expect(signal.clockSkewSeconds).toBe(0);
      expect(signal.detail).toContain("normal empty progress");
    });

    it("reports success and isNormalEmpty: false for a stream at startAt", () => {
      const signal = classifyStreamProgressOutcome(baseStream, 1000000);
      expect(signal.outcome).toBe("success");
      expect(signal.outcomeCode).toBe(STREAM_PROGRESS_OUTCOME_CODES.success);
      expect(signal.isNormalEmpty).toBe(false);
      expect(signal.clockSkewSeconds).toBe(0);
      expect(signal.detail).toContain("active progress initialized");
    });

    it("reports success and isNormalEmpty: false for an active or completed stream", () => {
      const signalActive = classifyStreamProgressOutcome(baseStream, 1000500);
      expect(signalActive.outcome).toBe("success");
      expect(signalActive.isNormalEmpty).toBe(false);

      const signalComplete = classifyStreamProgressOutcome(baseStream, 1002000);
      expect(signalComplete.outcome).toBe("success");
      expect(signalComplete.isNormalEmpty).toBe(false);
    });

    it("reports transient_delay when backwards step from previous observation is <= tolerance", () => {
      const signal = classifyStreamProgressOutcome(
        baseStream,
        1000500,
        1000500 + CLOCK_SKEW_TRANSIENT_THRESHOLD_SECONDS, // exactly 5s skew
      );
      expect(signal.outcome).toBe("transient_delay");
      expect(signal.outcomeCode).toBe(STREAM_PROGRESS_OUTCOME_CODES.transient_delay);
      expect(signal.isNormalEmpty).toBe(false);
      expect(signal.clockSkewSeconds).toBe(CLOCK_SKEW_TRANSIENT_THRESHOLD_SECONDS);
      expect(signal.detail).toContain("transient skew");
    });

    it("reports blocked when backwards step from previous observation exceeds tolerance", () => {
      const signal = classifyStreamProgressOutcome(
        baseStream,
        1000500,
        1000500 + CLOCK_SKEW_TRANSIENT_THRESHOLD_SECONDS + 1, // 6s skew
      );
      expect(signal.outcome).toBe("blocked");
      expect(signal.outcomeCode).toBe(STREAM_PROGRESS_OUTCOME_CODES.blocked);
      expect(signal.isNormalEmpty).toBe(false);
      expect(signal.clockSkewSeconds).toBe(6);
      expect(signal.detail).toContain("operator action required");
    });

    it("reports blocked when calculation time is earlier than stream.createdAt", () => {
      const signal = classifyStreamProgressOutcome(baseStream, 998990); // 10s before createdAt (999000)
      expect(signal.outcome).toBe("blocked");
      expect(signal.outcomeCode).toBe(STREAM_PROGRESS_OUTCOME_CODES.blocked);
      expect(signal.isNormalEmpty).toBe(false);
      expect(signal.clockSkewSeconds).toBe(10);
      expect(signal.detail).toContain("prior to stream creation");
    });
  });

  describe("evaluateStreamProgressClockSkew", () => {
    it("tracks monotonically advancing observations without warnings", () => {
      const warnSpy = vi.spyOn(logger, "warn");

      evaluateStreamProgressClockSkew(baseStream, 1000100);
      expect(getLastObservedProgressAt(baseStream.id)).toBe(1000100);
      expect(warnSpy).not.toHaveBeenCalled();

      evaluateStreamProgressClockSkew(baseStream, 1000200);
      expect(getLastObservedProgressAt(baseStream.id)).toBe(1000200);
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it("detects clock moving backwards and emits warning log with structured fields", () => {
      const warnSpy = vi.spyOn(logger, "warn");

      evaluateStreamProgressClockSkew(baseStream, 1000500);
      const signal = evaluateStreamProgressClockSkew(baseStream, 1000490); // 10s skew

      expect(signal.outcome).toBe("blocked");
      expect(signal.clockSkewSeconds).toBe(10);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "stream_progress_clock_skew",
          streamId: baseStream.id,
          outcome: "blocked",
          outcomeCode: 2,
          clockSkewSeconds: 10,
          isNormalEmpty: false,
        }),
        expect.stringContaining("operator action required"),
      );

      warnSpy.mockRestore();
    });

    it("handles streams without id safely", () => {
      const anonymousStream = { ...baseStream, id: undefined as any };
      const signal = evaluateStreamProgressClockSkew(anonymousStream, 1000000);
      expect(signal.streamId).toBe("unknown");
      expect(signal.outcome).toBe("success");
    });

    it("resets state on resetStreamProgressOutcome", () => {
      evaluateStreamProgressClockSkew(baseStream, 1000500);
      expect(getLastObservedProgressAt(baseStream.id)).toBe(1000500);
      expect(getLastStreamProgressSignal()).not.toBeNull();

      resetStreamProgressOutcome();
      expect(getLastObservedProgressAt(baseStream.id)).toBeUndefined();
      expect(getLastStreamProgressSignal()).toBeNull();
    });
  });
});
