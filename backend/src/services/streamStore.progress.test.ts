import { describe, expect, it, vi } from "vitest";
import { calculateProgress, StreamRecord } from "./streamStore";

// Mock the nowInSeconds function to control time in tests
vi.mock("./streamStore", async (importOriginal) => {
  const original = await importOriginal<typeof import("./streamStore")>();
  return {
    ...original,
    nowInSeconds: vi.fn(),
  };
});

describe("calculateProgress", () => {
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
});


