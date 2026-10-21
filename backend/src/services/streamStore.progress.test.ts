import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateProgress,
  getLastStreamProgressSignal,
  resetStreamProgressOutcome,
  STREAM_PROGRESS_OUTCOME_CODES,
  StreamRecord,
} from "./streamStore";
import { register } from "./metrics";
import { logger } from "../logger";

// Mock the nowInSeconds function to control time in tests
vi.mock("./streamStore", async (importOriginal) => {
  const original = await importOriginal<typeof import("./streamStore")>();
  return {
    ...original,
    nowInSeconds: vi.fn(),
  };
});

describe("calculateProgress", () => {
  beforeEach(() => {
    resetStreamProgressOutcome();
  });
  const mockSender = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const mockRecipient = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
  
  // Base stream template
  const createBaseStream = (overrides: Partial<StreamRecord> = {}): StreamRecord => ({
    id: "1",
    sender: mockSender,
    recipient: mockRecipient,
    assetCode: "USDC",
    totalAmount: 1000,
    durationSeconds: 3600, // 1 hour
    startAt: 1000000,
    createdAt: 999000,
    pausedDuration: 0,
    cliffSeconds: 0,
    ...overrides,
  });

  describe("Scheduled stream status (t < startAt)", () => {
    it("should return scheduled status with zero vested amount and progress", () => {
      const stream = createBaseStream({
        startAt: 1000000,
      });
      
      const currentTime = 999000; // Before start time
      const progress = calculateProgress(stream, currentTime);

      expect(progress.status).toBe("scheduled");
      expect(progress.vestedAmount).toBe(0);
      expect(progress.percentComplete).toBe(0);
      expect(progress.remainingAmount).toBe(1000);
      expect(progress.elapsedSeconds).toBe(0);
      expect(progress.ratePerSecond).toBeCloseTo(1000 / 3600, 6);
    });

    it("should handle scheduled stream with different amounts and durations", () => {
      const stream = createBaseStream({
        totalAmount: 2400,
        durationSeconds: 2400, // 40 minutes
        startAt: 2000000,
      });
      
      const currentTime = 1500000; // Before start time
      const progress = calculateProgress(stream, currentTime);

      expect(progress.status).toBe("scheduled");
      expect(progress.vestedAmount).toBe(0);
      expect(progress.percentComplete).toBe(0);
      expect(progress.remainingAmount).toBe(2400);
      expect(progress.ratePerSecond).toBe(1); // 2400 / 2400
    });
  });

  describe("Active stream status (startAt <= t < end)", () => {
    it("should return active status with linear vested amount calculation", () => {
      const stream = createBaseStream({
        startAt: 1000000,
        durationSeconds: 3600,
        totalAmount: 1000,
      });
      
      const currentTime = 1001800; // 30 minutes after start (halfway through 1-hour stream)
      const progress = calculateProgress(stream, currentTime);

      expect(progress.status).toBe("active");
      expect(progress.elapsedSeconds).toBe(1800); // 30 minutes
      expect(progress.vestedAmount).toBe(500); // Half of 1000
      expect(progress.remainingAmount).toBe(500);
      expect(progress.percentComplete).toBe(50);
      expect(progress.ratePerSecond).toBeCloseTo(1000 / 3600, 6);
    });

    it("should handle active stream at different progress points", () => {
      const stream = createBaseStream({
        startAt: 2000000,
        durationSeconds: 7200, // 2 hours
        totalAmount: 3600,
      });
      
      const currentTime = 2001800; // 30 minutes after start (25% through 2-hour stream)
      const progress = calculateProgress(stream, currentTime);

      expect(progress.status).toBe("active");
      expect(progress.elapsedSeconds).toBe(1800);
      expect(progress.vestedAmount).toBe(900); // 25% of 3600
      expect(progress.remainingAmount).toBe(2700);
      expect(progress.percentComplete).toBe(25);
      expect(progress.ratePerSecond).toBe(0.5); // 3600 / 7200
    });

    it("should handle active stream with paused duration", () => {
      const stream = createBaseStream({
        startAt: 1000000,
        durationSeconds: 3600,
        totalAmount: 1000,
        pausedDuration: 900, // 15 minutes paused
      });
      
      const currentTime = 1002700; // 45 minutes after start, but 15 minutes were paused
      const progress = calculateProgress(stream, currentTime);

      expect(progress.status).toBe("active");
      expect(progress.elapsedSeconds).toBe(1800); // 45 - 15 = 30 minutes effective
      expect(progress.vestedAmount).toBe(500); // Half of 1000 (30 min / 60 min)
      expect(progress.percentComplete).toBe(50);
    });

    it("should handle active stream currently paused", () => {
      const stream = createBaseStream({
        startAt: 1000000,
        durationSeconds: 3600,
        totalAmount: 1000,
        pausedDuration: 600, // 10 minutes previously paused
        pausedAt: 1001800, // Paused at 30 minutes mark
      });
      
      const currentTime = 1002700; // 45 minutes after start, currently paused for 15 minutes
      const progress = calculateProgress(stream, currentTime);

      expect(progress.status).toBe("paused");
      // Elapsed = 45 min - (10 min previous + 15 min current pause) = 20 min
      expect(progress.elapsedSeconds).toBe(1200);
      expect(progress.vestedAmount).toBeCloseTo(333.33, 0); // ~1/3 of 1000
      expect(progress.percentComplete).toBeCloseTo(33.33, 0);
    });
  });

  describe("Completed stream status (t >= end)", () => {
    it("should return completed status with 100% progress and full vested amount", () => {
      const stream = createBaseStream({
        startAt: 1000000,
        durationSeconds: 3600,
        totalAmount: 1000,
      });
      
      const currentTime = 1003600; // Exactly at end time
      const progress = calculateProgress(stream, currentTime);

      expect(progress.status).toBe("completed");
      expect(progress.elapsedSeconds).toBe(3600);
      expect(progress.vestedAmount).toBe(1000);
      expect(progress.remainingAmount).toBe(0);
      expect(progress.percentComplete).toBe(100);
      expect(progress.ratePerSecond).toBeCloseTo(1000 / 3600, 6);
    });

    it("should return completed status when time is past end", () => {
      const stream = createBaseStream({
        startAt: 1000000,
        durationSeconds: 3600,
        totalAmount: 1000,
      });
      
      const currentTime = 1007200; // 2 hours after end time
      const progress = calculateProgress(stream, currentTime);

      expect(progress.status).toBe("completed");
      expect(progress.elapsedSeconds).toBe(3600); // Capped at duration
      expect(progress.vestedAmount).toBe(1000);
      expect(progress.remainingAmount).toBe(0);
      expect(progress.percentComplete).toBe(100);
    });

    it("should handle completed stream with completedAt timestamp", () => {
      const stream = createBaseStream({
        startAt: 1000000,
        durationSeconds: 3600,
        totalAmount: 1000,
        completedAt: 1003600,
      });
      
      const currentTime = 1007200; // Well after completion
      const progress = calculateProgress(stream, currentTime);

      expect(progress.status).toBe("completed");
      expect(progress.vestedAmount).toBe(1000);
      expect(progress.percentComplete).toBe(100);
    });
  });

  describe("Canceled stream status", () => {
    it("should return canceled status regardless of time", () => {
      const stream = createBaseStream({
        startAt: 1000000,
        durationSeconds: 3600,
        totalAmount: 1000,
        canceledAt: 1001800, // Canceled at 30 minutes
      });
      
      const currentTime = 1007200; // Well after cancellation
      const progress = calculateProgress(stream, currentTime);

      expect(progress.status).toBe("canceled");
      expect(progress.elapsedSeconds).toBe(1800); // Up to cancellation time
      expect(progress.vestedAmount).toBe(500); // Vested up to cancellation
      expect(progress.remainingAmount).toBe(500);
      expect(progress.percentComplete).toBe(50);
      expect(progress.ratePerSecond).toBeCloseTo(1000 / 3600, 6);
    });

    it("should handle canceled stream before it started", () => {
      const stream = createBaseStream({
        startAt: 1000000,
        durationSeconds: 3600,
        totalAmount: 1000,
        canceledAt: 999000, // Canceled before start
      });
      
      const currentTime = 1007200;
      const progress = calculateProgress(stream, currentTime);

      expect(progress.status).toBe("canceled");
      expect(progress.elapsedSeconds).toBe(0); // No time elapsed
      expect(progress.vestedAmount).toBe(0);
      expect(progress.remainingAmount).toBe(1000);
      expect(progress.percentComplete).toBe(0);
    });

    it("should handle canceled stream after natural end time", () => {
      const stream = createBaseStream({
        startAt: 1000000,
        durationSeconds: 3600,
        totalAmount: 1000,
        canceledAt: 1007200, // Canceled after natural end
      });
      
      const currentTime = 1010800;
      const progress = calculateProgress(stream, currentTime);

      expect(progress.status).toBe("canceled");
      expect(progress.elapsedSeconds).toBe(3600); // Full duration vested
      expect(progress.vestedAmount).toBe(1000);
      expect(progress.remainingAmount).toBe(0);
      expect(progress.percentComplete).toBe(100);
    });

    it("should handle canceled stream with paused duration", () => {
      const stream = createBaseStream({
        startAt: 1000000,
        durationSeconds: 3600,
        totalAmount: 1000,
        pausedDuration: 900, // 15 minutes paused
        canceledAt: 1002700, // Canceled at 45 minutes mark
      });
      
      const currentTime = 1007200;
      const progress = calculateProgress(stream, currentTime);

      expect(progress.status).toBe("canceled");
      expect(progress.elapsedSeconds).toBe(1800); // 45 - 15 = 30 minutes effective
      expect(progress.vestedAmount).toBe(500); // Half vested
      expect(progress.percentComplete).toBe(50);
    });
  });

  describe("Rate per second calculation", () => {
    it("should calculate correct rate per second for various amounts and durations", () => {
      const testCases = [
        { totalAmount: 1000, durationSeconds: 3600, expectedRate: 1000 / 3600 },
        { totalAmount: 3600, durationSeconds: 3600, expectedRate: 1 },
        { totalAmount: 7200, durationSeconds: 3600, expectedRate: 2 },
        { totalAmount: 1800, durationSeconds: 7200, expectedRate: 0.25 },
      ];

      testCases.forEach(({ totalAmount, durationSeconds, expectedRate }) => {
        const stream = createBaseStream({
          totalAmount,
          durationSeconds,
          startAt: 1000000,
        });
        
        const progress = calculateProgress(stream, 1001800);
        expect(progress.ratePerSecond).toBeCloseTo(expectedRate, 6);
      });
    });
  });

  describe("Numerical precision and rounding", () => {
    it("should handle fractional amounts correctly", () => {
      const stream = createBaseStream({
        startAt: 1000000,
        durationSeconds: 3600,
        totalAmount: 1000.50,
      });
      
      const currentTime = 1001800; // Halfway through
      const progress = calculateProgress(stream, currentTime);

      expect(progress.vestedAmount).toBe(500.25); // Half of 1000.50
      expect(progress.remainingAmount).toBe(500.25);
    });

    it("should round values appropriately", () => {
      const stream = createBaseStream({
        startAt: 1000000,
        durationSeconds: 3600,
        totalAmount: 1000,
      });
      
      const currentTime = 1000600; // 10 minutes = 1/6 of hour
      const progress = calculateProgress(stream, currentTime);

      // 1000 * (1/6) = 166.666... should be rounded
      expect(progress.vestedAmount).toBeCloseTo(166.67, 2);
      expect(progress.percentComplete).toBeCloseTo(16.67, 2);
    });
  });

  describe("Edge cases", () => {
    it("should handle zero duration stream", () => {
      const stream = createBaseStream({
        startAt: 1000000,
        durationSeconds: 0,
        totalAmount: 1000,
      });
      
      const currentTime = 1000000;
      const progress = calculateProgress(stream, currentTime);

      expect(progress.status).toBe("completed");
      expect(progress.vestedAmount).toBe(1000);
      expect(progress.percentComplete).toBe(100);
      expect(progress.ratePerSecond).toBe(Infinity); // Division by zero
    });

    it("should handle zero amount stream", () => {
      const stream = createBaseStream({
        startAt: 1000000,
        durationSeconds: 3600,
        totalAmount: 0,
      });
      
      const currentTime = 1001800;
      const progress = calculateProgress(stream, currentTime);

      expect(progress.status).toBe("active");
      expect(progress.vestedAmount).toBe(0);
      expect(progress.remainingAmount).toBe(0);
      expect(progress.percentComplete).toBe(50);
      expect(progress.ratePerSecond).toBe(0);
    });

    it("should use current time when no time parameter provided", () => {
      const stream = createBaseStream({
        startAt: Date.now() / 1000 - 1800, // Started 30 minutes ago
        durationSeconds: 3600,
        totalAmount: 1000,
      });
      
      // Call without time parameter - should use nowInSeconds()
      const progress = calculateProgress(stream);

      expect(progress.status).toBe("active");
      expect(progress.vestedAmount).toBeGreaterThan(0);
      expect(progress.percentComplete).toBeGreaterThan(0);
    });
  });

  describe("Observability signals and clock regression handling (SSB-2026-129)", () => {
    it("distinguishes normal empty case (before start) from clock failure", () => {
      const stream = createBaseStream({
        id: "stream-sched-1",
        createdAt: 999000,
        startAt: 1000000,
        durationSeconds: 3600,
      });

      // Forward clock, but before stream start: normal empty case
      const progress = calculateProgress(stream, 999500);

      expect(progress.status).toBe("scheduled");
      expect(progress.vestedAmount).toBe(0);
      expect(progress.percentComplete).toBe(0);

      const signal = getLastStreamProgressSignal();
      expect(signal).not.toBeNull();
      expect(signal!.outcome).toBe("success");
      expect(signal!.outcomeCode).toBe(STREAM_PROGRESS_OUTCOME_CODES.success);
      expect(signal!.isNormalEmpty).toBe(true);
      expect(signal!.clockSkewSeconds).toBe(0);
      expect(signal!.streamId).toBe("stream-sched-1");
    });

    it("evaluates progress correctly at exact start timestamp", () => {
      const stream = createBaseStream({
        id: "stream-start-1",
        createdAt: 999000,
        startAt: 1000000,
        durationSeconds: 3600,
      });

      const progress = calculateProgress(stream, 1000000);

      expect(progress.status).toBe("active");
      expect(progress.vestedAmount).toBe(0);
      expect(progress.percentComplete).toBe(0);

      const signal = getLastStreamProgressSignal();
      expect(signal).not.toBeNull();
      expect(signal!.outcome).toBe("success");
      expect(signal!.isNormalEmpty).toBe(false);
      expect(signal!.clockSkewSeconds).toBe(0);
    });

    it("evaluates progress correctly at end timestamp", () => {
      const stream = createBaseStream({
        id: "stream-end-1",
        createdAt: 999000,
        startAt: 1000000,
        durationSeconds: 3600,
      });

      const progress = calculateProgress(stream, 1003600);

      expect(progress.status).toBe("completed");
      expect(progress.vestedAmount).toBe(1000);
      expect(progress.percentComplete).toBe(100);

      const signal = getLastStreamProgressSignal();
      expect(signal).not.toBeNull();
      expect(signal!.outcome).toBe("success");
      expect(signal!.isNormalEmpty).toBe(false);
      expect(signal!.clockSkewSeconds).toBe(0);
    });

    it("emits blocked outcome signal when clock moves backwards behind stream creation time", () => {
      const warnSpy = vi.spyOn(logger, "warn");
      const stream = createBaseStream({
        id: "stream-backwards-create",
        createdAt: 1000000,
        startAt: 1005000,
        durationSeconds: 3600,
      });

      // System clock evaluated at 999000 (1000s before stream was created)
      const progress = calculateProgress(stream, 999000);

      // Preserves safe math (vested amount 0, does not crash)
      expect(progress.vestedAmount).toBe(0);
      expect(progress.elapsedSeconds).toBe(0);

      const signal = getLastStreamProgressSignal();
      expect(signal).not.toBeNull();
      expect(signal!.outcome).toBe("blocked");
      expect(signal!.outcomeCode).toBe(STREAM_PROGRESS_OUTCOME_CODES.blocked);
      // Operators can tell this is NOT a normal empty case!
      expect(signal!.isNormalEmpty).toBe(false);
      expect(signal!.clockSkewSeconds).toBe(1000);
      expect(signal!.streamId).toBe("stream-backwards-create");
      expect(signal!.detail).toContain("System clock moved backwards");
      expect(signal!.detail).toContain("prior to stream creation");

      // Verify structured warning was logged
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "stream_progress_clock_skew",
          streamId: "stream-backwards-create",
          outcome: "blocked",
          outcomeCode: 2,
          clockSkewSeconds: 1000,
          isNormalEmpty: false,
        }),
        expect.stringContaining("System clock moved backwards"),
      );

      warnSpy.mockRestore();
    });

    it("emits transient_delay signal for small backwards clock step from previous calculation", () => {
      const warnSpy = vi.spyOn(logger, "warn");
      const stream = createBaseStream({
        id: "stream-small-skew",
        createdAt: 1000000,
        startAt: 1000000,
        durationSeconds: 3600,
      });

      // First observation at 1001000
      calculateProgress(stream, 1001000);
      let signal = getLastStreamProgressSignal();
      expect(signal!.outcome).toBe("success");

      // Second observation at 1000997 (clock moved backwards by 3s, <= 5s transient threshold)
      const progress = calculateProgress(stream, 1000997);
      expect(progress.status).toBe("active");

      signal = getLastStreamProgressSignal();
      expect(signal!.outcome).toBe("transient_delay");
      expect(signal!.outcomeCode).toBe(STREAM_PROGRESS_OUTCOME_CODES.transient_delay);
      expect(signal!.isNormalEmpty).toBe(false);
      expect(signal!.clockSkewSeconds).toBe(3);
      expect(signal!.detail).toContain("transient skew within 5s tolerance");

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "stream_progress_clock_skew",
          streamId: "stream-small-skew",
          outcome: "transient_delay",
          outcomeCode: 1,
          clockSkewSeconds: 3,
        }),
        expect.any(String),
      );

      warnSpy.mockRestore();
    });

    it("emits blocked signal for large backwards clock step from previous calculation", () => {
      const stream = createBaseStream({
        id: "stream-large-skew",
        createdAt: 1000000,
        startAt: 1000000,
        durationSeconds: 3600,
      });

      // First observation at 1001000
      calculateProgress(stream, 1001000);

      // Second observation at 1000900 (clock jumped backwards by 100s, > 5s)
      calculateProgress(stream, 1000900);

      const signal = getLastStreamProgressSignal();
      expect(signal!.outcome).toBe("blocked");
      expect(signal!.outcomeCode).toBe(STREAM_PROGRESS_OUTCOME_CODES.blocked);
      expect(signal!.isNormalEmpty).toBe(false);
      expect(signal!.clockSkewSeconds).toBe(100);
      expect(signal!.detail).toContain("operator action required to inspect clock synchronization");
    });

    it("ensures signals and logs do not leak wallet secrets or credentials", () => {
      const warnSpy = vi.spyOn(logger, "warn");
      const fakeSecretKey = "SBABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12";

      const stream = createBaseStream({
        id: "stream-secret-safety",
        createdAt: 1000000,
        startAt: 1005000,
      });

      // Force clock backwards
      calculateProgress(stream, 999000);

      const signal = getLastStreamProgressSignal();
      const signalJson = JSON.stringify(signal);
      expect(signalJson).not.toContain(fakeSecretKey);
      expect(signalJson).not.toContain("seed");
      expect(signalJson).not.toContain("privateKey");

      for (const call of warnSpy.mock.calls) {
        const loggedObj = call[0];
        const loggedStr = JSON.stringify(loggedObj);
        expect(loggedStr).not.toContain(fakeSecretKey);
        expect(loggedStr).not.toContain("secretKey");
        expect(loggedStr).not.toContain("privateKey");
      }

      warnSpy.mockRestore();
    });

    it("updates Prometheus metrics correctly on clock regression and recovery", async () => {
      const stream = createBaseStream({
        id: "stream-metrics-test",
        createdAt: 1000000,
        startAt: 1000000,
        durationSeconds: 3600,
      });

      // Normal progress
      calculateProgress(stream, 1001000);
      let metrics = await register.metrics();
      expect(metrics).toContain("stream_progress_outcome 0");

      // Clock backwards step
      calculateProgress(stream, 1000900);
      metrics = await register.metrics();
      expect(metrics).toContain("stream_progress_outcome 2");
      expect(metrics).toContain("stream_progress_clock_skew_seconds 100");
      expect(metrics).toContain("stream_progress_clock_skew_total");
    });
  });
});


