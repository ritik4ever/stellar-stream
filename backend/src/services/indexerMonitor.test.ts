/**
 * Unit tests for the indexer monitoring outcome signal.
 *
 * Verifies that the coarse `success` / `transient_delay` / `blocked`
 * classification matches the documented owner actions for the two reviewed
 * cases (RPC rate limit or disconnection, and lag while RPC is healthy), and
 * that the same signal is what gets published to Prometheus.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockIndexerOutcomeGauge, currentSnapshot } = vi.hoisted(() => ({
  mockIndexerOutcomeGauge: { set: vi.fn() },
  currentSnapshot: { value: undefined as unknown },
}));

vi.mock("./metrics", () => ({
  indexerOutcome: mockIndexerOutcomeGauge,
}));

vi.mock("./indexer", () => ({
  CircuitState: { CLOSED: "CLOSED", OPEN: "OPEN", HALF_OPEN: "HALF_OPEN" },
  getIndexerMonitoringSnapshot: () => currentSnapshot.value,
}));

import {
  INDEXER_OUTCOME_CODES,
  classifyIndexerOutcome,
  getIndexerOutcomeSignal,
  refreshIndexerMetrics,
} from "./indexerMonitor";
import type { IndexerMonitoringSnapshot } from "./indexer";

function makeSnapshot(
  overrides: Record<string, unknown> = {},
): IndexerMonitoringSnapshot {
  return {
    rpcConfigured: true,
    latestLedger: 1000,
    indexedLedger: 1000,
    ledgerLag: 0,
    consecutiveFailures: 0,
    failureThreshold: 5,
    circuitState: "CLOSED",
    lastFailureKind: null,
    pollInFlight: false,
    ...overrides,
  } as unknown as IndexerMonitoringSnapshot;
}

beforeEach(() => {
  vi.clearAllMocks();
  currentSnapshot.value = makeSnapshot();
});

describe("classifyIndexerOutcome", () => {
  it("reports success when the circuit is closed and the checkpoint is current", () => {
    const signal = classifyIndexerOutcome(makeSnapshot());

    expect(signal.outcome).toBe("success");
    expect(signal.outcomeCode).toBe(INDEXER_OUTCOME_CODES.success);
    expect(signal.detail).toMatch(/no owner action is required/i);
  });

  it("reports transient_delay for a rate-limited poll while the retry budget is intact", () => {
    const signal = classifyIndexerOutcome(
      makeSnapshot({
        consecutiveFailures: 1,
        lastFailureKind: "rate_limited",
        ledgerLag: 1,
      }),
    );

    expect(signal.outcome).toBe("transient_delay");
    expect(signal.outcomeCode).toBe(INDEXER_OUTCOME_CODES.transient_delay);
    expect(signal.detail).toMatch(/rate limit/i);
    expect(signal.detail).toMatch(/retry budget is intact/i);
  });

  it("reports transient_delay for a disconnection while the retry budget is intact", () => {
    const signal = classifyIndexerOutcome(
      makeSnapshot({
        consecutiveFailures: 3,
        lastFailureKind: "disconnected",
      }),
    );

    expect(signal.outcome).toBe("transient_delay");
    expect(signal.detail).toMatch(/connection failed or timed out/i);
    expect(signal.detail).toMatch(/3\/5/);
  });

  it("reports transient_delay while a half-open recovery probe is allowed", () => {
    const signal = classifyIndexerOutcome(
      makeSnapshot({
        circuitState: "HALF_OPEN",
        consecutiveFailures: 5,
        lastFailureKind: "disconnected",
      }),
    );

    expect(signal.outcome).toBe("transient_delay");
    expect(signal.detail).toMatch(/half-open probe/i);
  });

  it("reports blocked once the circuit is open", () => {
    const signal = classifyIndexerOutcome(
      makeSnapshot({
        circuitState: "OPEN",
        consecutiveFailures: 5,
        lastFailureKind: "rate_limited",
        ledgerLag: 12,
      }),
    );

    expect(signal.outcome).toBe("blocked");
    expect(signal.outcomeCode).toBe(INDEXER_OUTCOME_CODES.blocked);
    expect(signal.detail).toMatch(/rate limit/i);
    expect(signal.detail).toMatch(/provider rate-limit status/i);
  });

  it("reports blocked when work is outstanding and no RPC is configured", () => {
    const signal = classifyIndexerOutcome(
      makeSnapshot({
        rpcConfigured: false,
        latestLedger: null,
        ledgerLag: 7,
      }),
    );

    expect(signal.outcome).toBe("blocked");
    expect(signal.detail).toMatch(/Stellar RPC URL and contract/i);
  });

  it("keeps an unconfigured but idle indexer at success", () => {
    const signal = classifyIndexerOutcome(
      makeSnapshot({
        rpcConfigured: false,
        latestLedger: null,
        ledgerLag: 0,
        consecutiveFailures: 0,
      }),
    );

    expect(signal.outcome).toBe("success");
  });

  it("does not treat a non-zero lag alone as blocked while RPC is healthy", () => {
    const signal = classifyIndexerOutcome(
      makeSnapshot({ ledgerLag: 4, pollInFlight: true }),
    );

    expect(signal.outcome).toBe("success");
    expect(signal.state.ledgerLag).toBe(4);
  });

  it("never leaks an RPC URL, contract, credential or raw provider code", () => {
    const signal = classifyIndexerOutcome(
      makeSnapshot({
        circuitState: "OPEN",
        consecutiveFailures: 5,
        lastFailureKind: "disconnected",
        // Hostile extras: a classifier that stringified the snapshot would
        // echo these into the detail.
        rpcUrl: "https://rpc.internal.example/v1/SECRET-KEY",
        contractId: "CCONTRACTSECRET",
        lastErrorMessage: "ECONNREFUSED 10.0.0.1:443",
      }),
    );

    expect(signal.detail).not.toMatch(/https?:\/\//);
    expect(signal.detail).not.toMatch(/secret/i);
    expect(signal.detail).not.toMatch(/econnrefused|10\.0\.0\.1|contractsecret/i);
  });
});

describe("getIndexerOutcomeSignal", () => {
  it("classifies the live indexer snapshot", () => {
    currentSnapshot.value = makeSnapshot({
      consecutiveFailures: 2,
      lastFailureKind: "rate_limited",
    });

    const signal = getIndexerOutcomeSignal();

    expect(signal.outcome).toBe("transient_delay");
    expect(signal.state.lastFailureKind).toBe("rate_limited");
  });
});

describe("refreshIndexerMetrics", () => {
  it("publishes the numeric outcome code to Prometheus", () => {
    const signal = refreshIndexerMetrics();

    expect(signal.outcome).toBe("success");
    expect(mockIndexerOutcomeGauge.set).toHaveBeenCalledWith(
      INDEXER_OUTCOME_CODES.success,
    );
  });

  it("publishes blocked when the live snapshot is blocked", () => {
    currentSnapshot.value = makeSnapshot({
      circuitState: "OPEN",
      consecutiveFailures: 5,
      lastFailureKind: "disconnected",
    });

    const signal = refreshIndexerMetrics(
      currentSnapshot.value as IndexerMonitoringSnapshot,
    );

    expect(signal.outcome).toBe("blocked");
    expect(mockIndexerOutcomeGauge.set).toHaveBeenCalledWith(
      INDEXER_OUTCOME_CODES.blocked,
    );
  });
});
