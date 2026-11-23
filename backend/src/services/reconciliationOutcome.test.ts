import { beforeEach, describe, expect, it, vi } from "vitest";

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../logger", () => ({ logger: loggerMock }));

import { runWithCorrelation } from "../correlationContext";
import {
  RECONCILIATION_OUTCOME_CODES,
  buildReconciliationRpcOutageDetail,
  classifyReconciliationErrorKind,
  emitReconciliationSignal,
  getLastReconciliationSignal,
  isReconciliationRpcOutage,
  resetReconciliationOutcomeForTesting,
} from "./reconciliationOutcome";
import { register } from "./metrics";

describe("reconciliationOutcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetReconciliationOutcomeForTesting();
  });

  it("uses stable numeric outcome codes", () => {
    expect(RECONCILIATION_OUTCOME_CODES).toEqual({
      success: 0,
      rpc_outage: 1,
      failure: 2,
    });
  });

  it("classifies RPC failures into enumerated error kinds", () => {
    expect(classifyReconciliationErrorKind(new Error("timeout: RPC server did not respond"))).toBe("timeout");
    expect(classifyReconciliationErrorKind(new Error("ECONNREFUSED rpc endpoint"))).toBe("connection");
    expect(classifyReconciliationErrorKind(new Error("429 rate limit exceeded"))).toBe("rate_limited");
    expect(classifyReconciliationErrorKind(new Error("Soroban simulation failed"))).toBe("provider_error");
    expect(classifyReconciliationErrorKind(new Error("disk full"))).toBe("unexpected");
    expect(isReconciliationRpcOutage(new Error("timeout: RPC server did not respond"))).toBe(true);
    expect(isReconciliationRpcOutage(new Error("disk full"))).toBe(false);
  });

  it("emits a normal empty success signal distinct from failure", () => {
    const signal = emitReconciliationSignal({
      outcome: "success",
      detail: "Normal empty reconciliation: local state is current and no missing streams were detected.",
      isNormalEmpty: true,
      latencyMs: 12,
      stage: "missing_streams",
      repairedCount: 0,
      missingCount: 0,
    });

    expect(signal.outcomeCode).toBe(0);
    expect(signal.isNormalEmpty).toBe(true);
    expect(signal.latencyMs).toBe(12);
    expect(getLastReconciliationSignal()).toEqual(signal);
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "reconciliation_success",
        isNormalEmpty: true,
        outcome: "success",
      }),
      signal.detail,
    );
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it("emits actionable rpc_outage signals without raw errors, URLs, or credentials", async () => {
    const secret = `S${"A".repeat(55)}`;
    const rpcUrl = `https://user:password@rpc.internal/SECRET/${secret}`;
    const errorKind = classifyReconciliationErrorKind(
      new Error(`timeout: RPC server ${rpcUrl} did not respond`),
    );
    const detail = buildReconciliationRpcOutageDetail("stream_backfill", errorKind, "7", 2, 5);

    const signal = emitReconciliationSignal({
      outcome: "rpc_outage",
      detail,
      isNormalEmpty: false,
      latencyMs: 34,
      stage: "stream_backfill",
      repairedCount: 2,
      missingCount: 5,
      errorKind,
      streamId: "7",
    });

    expect(signal.outcomeCode).toBe(1);
    expect(signal.isNormalEmpty).toBe(false);
    expect(signal.errorKind).toBe("timeout");
    expect(signal.streamId).toBe("7");
    expect(detail).toContain("Owner action");
    expect(JSON.stringify(signal)).not.toContain(secret);
    expect(JSON.stringify(signal)).not.toContain(rpcUrl);
    expect(JSON.stringify(signal)).not.toContain("password");
    expect(JSON.stringify(loggerMock.error.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(loggerMock.error.mock.calls)).not.toContain(rpcUrl);
    expect(await register.getSingleMetricAsString("reconciliation_outcome")).toContain(
      "reconciliation_outcome 1",
    );
  });

  it("links logs with a request ID and correlation ID", () => {
    let signal: ReturnType<typeof emitReconciliationSignal> | undefined;
    runWithCorrelation("cycle-42", () => {
      signal = emitReconciliationSignal({
        outcome: "failure",
        detail: "Reconciliation failed before completion.",
        isNormalEmpty: false,
        latencyMs: 8,
        stage: "missing_streams",
        repairedCount: 0,
        missingCount: 0,
        requestId: "req-abc-123",
      });
    });

    expect(signal?.correlationId).toBe("cycle-42");
    expect(signal?.requestId).toBe("req-abc-123");
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "reconciliation_failure",
        correlation_id: "cycle-42",
        requestId: "req-abc-123",
      }),
      "Reconciliation failed before completion.",
    );
  });
});
