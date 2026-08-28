import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock external dependencies to isolate the CircuitBreaker tests
// and avoid native module resolution errors (like better-sqlite3).
vi.mock("./db", () => ({
  getDb: vi.fn(),
}));
vi.mock("./metrics", () => ({
  eventsIndexedTotal: { inc: vi.fn() },
  ledgersScannedTotal: { inc: vi.fn() },
  lastIndexedLedger: { set: vi.fn() },
  indexerErrorsTotal: { inc: vi.fn() },
  indexerCircuitState: { set: vi.fn() },
  recordIndexerSuccess: vi.fn(),
  httpRequestsTotal: { inc: vi.fn() },
  httpRequestDurationMs: { observe: vi.fn() },
  streamCountByStatus: { set: vi.fn() },
  claimCount: { set: vi.fn() },
  cancelCount: { set: vi.fn() },
  indexerLagSeconds: { set: vi.fn() },
  refreshPrometheusStreamMetrics: vi.fn(),
  resetPrometheusStreamMetricsCache: vi.fn(),
  resetIndexerLag: vi.fn(),
}));

import { CircuitBreaker } from "./indexer";

describe("CircuitBreaker State Transitions", () => {
  let circuitBreaker: CircuitBreaker;
  
  // Define test constants matching typical implementation defaults
  const FAILURE_THRESHOLD = 5;
  const TIMEOUT_MS = 60000; // Assuming 60 seconds for timeout threshold

  beforeEach(() => {
    // Enable fake timers to test time-based transitions without real waiting
    vi.useFakeTimers();
    
    // Instantiate the CircuitBreaker. If your implementation requires constructor 
    // arguments (e.g. `new CircuitBreaker(FAILURE_THRESHOLD, TIMEOUT_MS)`), 
    // they can be passed here.
    circuitBreaker = new CircuitBreaker(); 
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("should remain CLOSED below the failure threshold (4 failures)", () => {
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      circuitBreaker.onFailure();
    }
    expect(circuitBreaker.getState()).toBe("CLOSED");
  });

  it("should transition to OPEN after reaching the failure threshold (5 failures)", () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      circuitBreaker.onFailure();
    }
    expect(circuitBreaker.getState()).toBe("OPEN");
  });

  it("should transition to HALF_OPEN after the reset timeout has elapsed", () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      circuitBreaker.onFailure();
    }
    expect(circuitBreaker.getState()).toBe("OPEN");

    // Advance time past timeoutMs
    vi.advanceTimersByTime(TIMEOUT_MS + 1);
    expect(circuitBreaker.getState()).toBe("HALF_OPEN");
  });

  it("should reset to CLOSED if onSuccess is called while HALF_OPEN", () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      circuitBreaker.onFailure();
    }
    vi.advanceTimersByTime(TIMEOUT_MS + 1);
    expect(circuitBreaker.getState()).toBe("HALF_OPEN");

    circuitBreaker.onSuccess();
    expect(circuitBreaker.getState()).toBe("CLOSED");
  });

  it("should return to OPEN if onFailure is called while HALF_OPEN", () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      circuitBreaker.onFailure();
    }
    vi.advanceTimersByTime(TIMEOUT_MS + 1);
    expect(circuitBreaker.getState()).toBe("HALF_OPEN");

    circuitBreaker.onFailure();
    expect(circuitBreaker.getState()).toBe("OPEN");
  });
});