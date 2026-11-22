import { getCorrelationId } from "../correlationContext";
import { logger } from "../logger";
import {
  reconciliationLatencyMs as reconciliationLatencyMsGauge,
  reconciliationOutcome as reconciliationOutcomeGauge,
  reconciliationRpcOutagesTotal as reconciliationRpcOutagesTotalCounter,
} from "./metrics";

export type ReconciliationOutcome = "success" | "rpc_outage" | "failure";

export const RECONCILIATION_OUTCOME_CODES: Record<ReconciliationOutcome, number> = {
  success: 0,
  rpc_outage: 1,
  failure: 2,
};

export interface ReconciliationSignalContext {
  requestId?: string;
  correlationId?: string;
}

export type ReconciliationStage =
  | "not_configured"
  | "validation"
  | "next_stream_id"
  | "missing_streams"
  | "stream_backfill"
  | "stream_reconcile";

export type ReconciliationErrorKind =
  | "timeout"
  | "connection"
  | "rate_limited"
  | "provider_error"
  | "unexpected";

export interface ReconciliationOutcomeSignal {
  outcome: ReconciliationOutcome;
  outcomeCode: number;
  detail: string;
  isNormalEmpty: boolean;
  latencyMs: number;
  stage: ReconciliationStage;
  repairedCount: number;
  missingCount: number;
  errorKind?: ReconciliationErrorKind;
  streamId?: string;
  requestId?: string;
  correlationId?: string;
}

let lastPublishedSignal: ReconciliationOutcomeSignal | null = null;

export function classifyReconciliationErrorKind(err: unknown): ReconciliationErrorKind {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : err && typeof err === "object" && "message" in err
          ? String((err as { message?: unknown }).message ?? "")
          : "";
  const message = raw.toLowerCase();

  if (!message) return "unexpected";
  if (message.includes("timeout") || message.includes("timed out") || message.includes("etimedout")) {
    return "timeout";
  }
  if (message.includes("rate limit") || message.includes("429")) return "rate_limited";
  if (
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("disconnect")
  ) {
    return "connection";
  }
  if (
    message.includes("rpc") ||
    message.includes("soroban") ||
    message.includes("simulation") ||
    message.includes("provider")
  ) {
    return "provider_error";
  }
  return "unexpected";
}

export function describeReconciliationErrorKind(kind: ReconciliationErrorKind): string {
  switch (kind) {
    case "timeout":
      return "the RPC call timed out";
    case "connection":
      return "the RPC connection failed";
    case "rate_limited":
      return "the provider reported a rate limit";
    case "provider_error":
      return "the provider returned an error response";
    default:
      return "an unexpected error occurred";
  }
}

export function isReconciliationRpcOutage(err: unknown): boolean {
  return classifyReconciliationErrorKind(err) !== "unexpected";
}

export function buildReconciliationRpcOutageDetail(
  stage: ReconciliationStage,
  errorKind: ReconciliationErrorKind,
  streamId?: string,
  repairedCount = 0,
  missingCount = 0,
): string {
  const reason = describeReconciliationErrorKind(errorKind);

  if (stage === "next_stream_id") {
    return (
      `Reconciliation RPC outage while reading the next on-chain stream ID (${reason}). ` +
      "Owner action: verify RPC availability and provider rate-limit status. " +
      "No state was changed; the next scheduled cycle retries automatically."
    );
  }

  if (stage === "stream_reconcile") {
    return (
      `Reconciliation RPC outage while checking stream ${streamId ?? "unknown"} against confirmed on-chain state (${reason}). ` +
      "Owner action: verify RPC availability and retry the stream reconciliation once the provider recovers."
    );
  }

  const remaining = Math.max(0, missingCount - repairedCount);
  return (
    `Reconciliation RPC outage while backfilling stream ${streamId ?? "unknown"} (${reason}). ` +
    `The worker stopped early after committing ${repairedCount} stream(s); ${remaining} remain for the next cycle. ` +
    "Owner action: verify RPC availability and provider rate-limit status. Do not restart in a loop."
  );
}

export function emitReconciliationSignal(
  signal: Omit<ReconciliationOutcomeSignal, "outcomeCode">,
): ReconciliationOutcomeSignal {
  const fullSignal: ReconciliationOutcomeSignal = {
    ...signal,
    outcomeCode: RECONCILIATION_OUTCOME_CODES[signal.outcome],
    correlationId: signal.correlationId ?? getCorrelationId(),
  };

  lastPublishedSignal = fullSignal;
  reconciliationOutcomeGauge.set(fullSignal.outcomeCode);
  reconciliationLatencyMsGauge.set(fullSignal.latencyMs);
  if (fullSignal.outcome === "rpc_outage") {
    reconciliationRpcOutagesTotalCounter.inc();
  }

  const event =
    fullSignal.outcome === "rpc_outage"
      ? "reconciliation_rpc_outage"
      : fullSignal.outcome === "failure"
        ? "reconciliation_failure"
        : "reconciliation_success";

  if (fullSignal.outcome === "success") {
    logger.info({ event, ...fullSignal, correlation_id: fullSignal.correlationId }, fullSignal.detail);
  } else {
    logger.error({ event, ...fullSignal, correlation_id: fullSignal.correlationId }, fullSignal.detail);
  }

  return fullSignal;
}

export function getLastReconciliationSignal(): ReconciliationOutcomeSignal | null {
  return lastPublishedSignal;
}

export function resetReconciliationOutcomeForTesting(): void {
  lastPublishedSignal = null;
  reconciliationOutcomeGauge.set(RECONCILIATION_OUTCOME_CODES.success);
  reconciliationLatencyMsGauge.set(0);
}
