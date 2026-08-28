import { describe, expect, it, vi } from "vitest";
import { calculateMilestones, StreamRecord } from "./streamStore";

// Mock the nowInSeconds function to control time in tests
vi.mock("./streamStore", async (importOriginal) => {
  const original = await importOriginal<typeof import("./streamStore")>();
  return {
    ...original,
    nowInSeconds: vi.fn(),
  };
});

describe("calculateMilestones", () => {
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
    stepDurationSeconds: null,
    stepCount: null,
    ...overrides,
  });

  describe("Linear streams (no cliff, no steps)", () => {
    it("should return empty array for linear stream", () => {
      const stream = createBaseStream({
        cliffSeconds: 0,
        stepDurationSeconds: null,
        stepCount: null,
      });
      
      const milestones = calculateMilestones(stream, 1000500);
      expect(milestones).toEqual([]);
    });
  });

  describe("Cliff vesting", () => {
    it("should return cliff as first milestone", () => {
      const stream = createBaseStream({
        cliffSeconds: 1800, // 30 minutes cliff
        totalAmount: 1000,
        durationSeconds: 3600,
      });
      
      const milestones = calculateMilestones(stream, 1000500);
      
      expect(milestones).toHaveLength(1);
      expect(milestones[0]).toEqual({
        timestamp: 1001800, // startAt + cliffSeconds
        amount_unlocked: 500, // 50% of total (1800/3600 * 1000)
        cumulative_unlocked: 500,
        reached: false, // 1000500 < 1001800
      });
    });

    it("should mark cliff as reached when time is past cliff", () => {
      const stream = createBaseStream({
        cliffSeconds: 1800,
        totalAmount: 1000,
        durationSeconds: 3600,
      });
      
      const milestones = calculateMilestones(stream, 1002000); // Past cliff
      
      expect(milestones).toHaveLength(1);
      expect(milestones[0].reached).toBe(true);
    });

    it("should handle cliff that is 100% of duration", () => {
      const stream = createBaseStream({
        cliffSeconds: 3600, // Same as duration
        totalAmount: 1000,
        durationSeconds: 3600,
      });
      
      const milestones = calculateMilestones(stream, 1000500);
      
      expect(milestones).toHaveLength(1);
      expect(milestones[0].amount_unlocked).toBe(1000); // 100% of total
      expect(milestones[0].cumulative_unlocked).toBe(1000);
    });
  });

  describe("Step vesting", () => {
    it("should return all steps in chronological order", () => {
      const stream = createBaseStream({
        stepDurationSeconds: 900, // 15 minutes per step
        stepCount: 4, // 4 steps total
        totalAmount: 1000,
        durationSeconds: 3600,
      });
      
      const milestones = calculateMilestones(stream, 1000500);
      
      expect(milestones).toHaveLength(4);
      
      // Step 1
      expect(milestones[0]).toEqual({
        timestamp: 1000900, // startAt + 900
        amount_unlocked: 250, // 1000 / 4
        cumulative_unlocked: 250,
        reached: false,
      });
      
      // Step 2
      expect(milestones[1]).toEqual({
        timestamp: 1001800, // startAt + 1800
        amount_unlocked: 250,
        cumulative_unlocked: 500,
        reached: false,
      });
      
      // Step 3
      expect(milestones[2]).toEqual({
        timestamp: 1002700, // startAt + 2700
        amount_unlocked: 250,
        cumulative_unlocked: 750,
        reached: false,
      });
      
      // Step 4
      expect(milestones[3]).toEqual({
        timestamp: 1003600, // startAt + 3600
        amount_unlocked: 250,
        cumulative_unlocked: 1000,
        reached: false,
      });
    });

    it("should mark steps as reached when time is past each step", () => {
      const stream = createBaseStream({
        stepDurationSeconds: 900,
        stepCount: 4,
        totalAmount: 1000,
        durationSeconds: 3600,
      });
      
      const milestones = calculateMilestones(stream, 1002000); // Past step 2
      
      expect(milestones).toHaveLength(4);
      expect(milestones[0].reached).toBe(true);  // Step 1 (900s)
      expect(milestones[1].reached).toBe(true);  // Step 2 (1800s)
      expect(milestones[2].reached).toBe(false); // Step 3 (2700s)
      expect(milestones[3].reached).toBe(false); // Step 4 (3600s)
    });

    it("should handle non-divisible amounts correctly", () => {
      const stream = createBaseStream({
        stepDurationSeconds: 1000,
        stepCount: 3,
        totalAmount: 1000,
        durationSeconds: 3000,
      });
      
      const milestones = calculateMilestones(stream, 1000500);
      
      expect(milestones).toHaveLength(3);
      // Each step gets 333.333333, but rounded
      expect(milestones[0].amount_unlocked).toBeCloseTo(333.333333, 4);
      expect(milestones[1].amount_unlocked).toBeCloseTo(333.333333, 4);
      expect(milestones[2].amount_unlocked).toBeCloseTo(333.333333, 4);
      
      // Cumulative should add up to total
      expect(milestones[2].cumulative_unlocked).toBeCloseTo(1000, 4);
    });
  });

  describe("Cliff + Step vesting combined", () => {
    it("should return cliff milestone first, then step milestones", () => {
      const stream = createBaseStream({
        cliffSeconds: 600, // 10 minutes cliff
        stepDurationSeconds: 1200, // 20 minutes per step
        stepCount: 3, // 3 steps
        totalAmount: 1000,
        durationSeconds: 3600,
      });
      
      const milestones = calculateMilestones(stream, 1000500);
      
      // Should have 4 milestones: 1 cliff + 3 steps
      expect(milestones).toHaveLength(4);
      
      // First milestone is cliff at startAt + 600
      expect(milestones[0].timestamp).toBe(1000600);
      expect(milestones[0].amount_unlocked).toBeCloseTo(166.6667, 3); // 600/3600 * 1000
      
      // Then steps at startAt + 1200, 2400, 3600
      expect(milestones[1].timestamp).toBe(1001200);
      expect(milestones[2].timestamp).toBe(1002400);
      expect(milestones[3].timestamp).toBe(1003600);
    });
  });

  describe("Edge cases", () => {
    it("should handle zero cliffSeconds", () => {
      const stream = createBaseStream({
        cliffSeconds: 0,
        stepDurationSeconds: null,
        stepCount: null,
      });
      
      const milestones = calculateMilestones(stream, 1000500);
      expect(milestones).toEqual([]);
    });

    it("should handle null step fields", () => {
      const stream = createBaseStream({
        cliffSeconds: 0,
        stepDurationSeconds: null,
        stepCount: null,
      });
      
      const milestones = calculateMilestones(stream, 1000500);
      expect(milestones).toEqual([]);
    });

    it("should handle undefined step fields", () => {
      const stream = createBaseStream({
        cliffSeconds: 0,
        stepDurationSeconds: undefined,
        stepCount: undefined,
      });
      
      const milestones = calculateMilestones(stream, 1000500);
      expect(milestones).toEqual([]);
    });

    it("should handle stepDurationSeconds = 0", () => {
      const stream = createBaseStream({
        cliffSeconds: 0,
        stepDurationSeconds: 0,
        stepCount: 4,
      });
      
      const milestones = calculateMilestones(stream, 1000500);
      expect(milestones).toEqual([]);
    });

    it("should handle stepCount = 0", () => {
      const stream = createBaseStream({
        cliffSeconds: 0,
        stepDurationSeconds: 900,
        stepCount: 0,
      });
      
      const milestones = calculateMilestones(stream, 1000500);
      expect(milestones).toEqual([]);
    });
  });
});
