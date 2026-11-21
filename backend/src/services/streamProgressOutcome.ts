import { logger } from "../logger";
import {
  streamProgressClockSkewSeconds as streamProgressClockSkewGauge,
  streamProgressClockSkewTotal,
  streamProgressOutcome as streamProgressOutcomeGauge,
} from "./metrics";
import type { StreamRecord } from "./streamStore";

/**
 * Coarse, secret-free outcome for the Stream progress math workflow.
 *
 * - `success` (0) — Normal progress math calculation. Includes streams before start
 *   (scheduled / normal empty case), at start, active, completed, or paused/canceled.
 * - `transient_delay` (1) — System clock moved backwards by a small, transient interval
 *   (<= 5 seconds, standard NTP adjustment tolerance). Self-healing without operator intervention.
 * - `blocked` (2) — System clock moved backwards significantly (> 5 seconds or behind
 *   stream creation timestamp `createdAt`). Operator action required to review server clock
 *   synchronization (NTP/PTP/VM hypervisor clock drift).
 */
export type StreamProgressOutcome = "success" | "transient_delay" | "blocked";

/**
 * Stable numeric encoding for the Prometheus gauge and for alert rules.
 * Do not renumber: dashboards and alert rules key off these values.
 */
export const STREAM_PROGRESS_OUTCOME_CODES: Record<StreamProgressOutcome, number> = {
  success: 0,
  transient_delay: 1,
  blocked: 2,
};

/**
 * Threshold in seconds for distinguishing small transient clock adjustments
 * (e.g. NTP slew) from severe clock regression requiring operator attention.
 */
export const CLOCK_SKEW_TRANSIENT_THRESHOLD_SECONDS = 5;

export interface StreamProgressOutcomeSignal {
  outcome: StreamProgressOutcome;
  outcomeCode: number;
  /**
   * Actionable explanation. Contains only timestamps, skew deltas, and state:
   * never wallet secret keys, seed phrases, or user credentials.
   */
  detail: string;
  streamId: string;
  /**
   * True only for a normal scheduled stream before start (`at < stream.startAt`
   * with a healthy forward clock). Crucial for operators to distinguish normal
   * zero-vested empty states from system clock regression failures.
   */
  isNormalEmpty: boolean;
  /** Number of seconds the system clock moved backwards (0 if forward). */
  clockSkewSeconds: number;
  /** Duration of the progress calculation in milliseconds. */
  latencyMs: number;
  /** The timestamp at which progress was evaluated. */
  calculatedAt: number;
  /** The prior timestamp or stream creation timestamp compared against. */
  referenceAt?: number;
}

/** In-memory tracking of the last observed progress calculation timestamp per stream. */
const lastObservedProgressAtByStream = new Map<string, number>();

/** The most recently published signal. */
let lastPublishedSignal: StreamProgressOutcomeSignal | null = null;

/** Test helper: clears in-memory tracking and published signals between test runs. */
export function resetStreamProgressOutcome(): void {
  lastObservedProgressAtByStream.clear();
  lastPublishedSignal = null;
  streamProgressOutcomeGauge.set(STREAM_PROGRESS_OUTCOME_CODES.success);
  streamProgressClockSkewGauge.set(0);
}

/**
 * Retrieve the last observed calculation timestamp for a stream ID.
 */
export function getLastObservedProgressAt(streamId: string): number | undefined {
  return lastObservedProgressAtByStream.get(streamId);
}

/**
 * Retrieve the most recently emitted outcome signal.
 */
export function getLastStreamProgressSignal(): StreamProgressOutcomeSignal | null {
  return lastPublishedSignal;
}

/**
 * Pure classifier: evaluates stream timestamps, current calculation time `at`,
 * and any previous observation timestamp into a structured outcome signal.
 */
export function classifyStreamProgressOutcome(
  stream: StreamRecord,
  at: number,
  lastObservedAt?: number,
  latencyMs = 0,
): StreamProgressOutcomeSignal {
  const streamId = stream.id ?? "unknown";

  // Check 1: Monotonic regression from previous calculation of this stream
  const skewFromPrevious =
    lastObservedAt !== undefined && at < lastObservedAt
      ? lastObservedAt - at
      : 0;

  // Check 2: Calculation time earlier than stream creation timestamp
  const skewFromCreation =
    stream.createdAt !== undefined && at < stream.createdAt
      ? stream.createdAt - at
      : 0;

  const clockSkewSeconds = Math.max(skewFromPrevious, skewFromCreation);
  const referenceAt =
    skewFromPrevious >= skewFromCreation && lastObservedAt !== undefined
      ? lastObservedAt
      : stream.createdAt;

  // System clock moving backwards
  if (clockSkewSeconds > 0) {
    const isTransient =
      clockSkewSeconds <= CLOCK_SKEW_TRANSIENT_THRESHOLD_SECONDS &&
      skewFromCreation === 0;

    const outcome: StreamProgressOutcome = isTransient ? "transient_delay" : "blocked";
    const detail = isTransient
      ? `System clock moved backwards by ${clockSkewSeconds}s (transient skew within ${CLOCK_SKEW_TRANSIENT_THRESHOLD_SECONDS}s tolerance).`
      : `System clock moved backwards by ${clockSkewSeconds}s (${
          skewFromCreation > 0 ? "prior to stream creation" : "exceeds transient tolerance"
        }); operator action required to inspect clock synchronization.`;

    return {
      outcome,
      outcomeCode: STREAM_PROGRESS_OUTCOME_CODES[outcome],
      detail,
      streamId,
      isNormalEmpty: false,
      clockSkewSeconds,
      latencyMs,
      calculatedAt: at,
      referenceAt,
    };
  }

  // Normal time cases:
  // Before start: normal empty case
  if (at < stream.startAt) {
    return {
      outcome: "success",
      outcomeCode: STREAM_PROGRESS_OUTCOME_CODES.success,
      detail: "Stream is scheduled before startAt; normal empty progress.",
      streamId,
      isNormalEmpty: true,
      clockSkewSeconds: 0,
      latencyMs,
      calculatedAt: at,
      referenceAt: stream.startAt,
    };
  }

  // At start
  if (at === stream.startAt) {
    return {
      outcome: "success",
      outcomeCode: STREAM_PROGRESS_OUTCOME_CODES.success,
      detail: "Stream at start timestamp; active progress initialized.",
      streamId,
      isNormalEmpty: false,
      clockSkewSeconds: 0,
      latencyMs,
      calculatedAt: at,
      referenceAt: stream.startAt,
    };
  }

  // Active, completed, paused, or canceled under normal forward clock
  return {
    outcome: "success",
    outcomeCode: STREAM_PROGRESS_OUTCOME_CODES.success,
    detail: "Stream progress calculated successfully.",
    streamId,
    isNormalEmpty: false,
    clockSkewSeconds: 0,
    latencyMs,
    calculatedAt: at,
  };
}

/**
 * Evaluates clock skew for a stream progress calculation, records telemetry
 * (Prometheus metrics and structured log signals), and maintains monotonic state.
 *
 * Preserves zero-secret safety: never logs wallet secret keys, private keys, or credentials.
 */
export function evaluateStreamProgressClockSkew(
  stream: StreamRecord,
  at: number,
  startPerfMs?: number,
): StreamProgressOutcomeSignal {
  const latencyMs =
    startPerfMs !== undefined ? Math.max(0, Date.now() - startPerfMs) : 0;
  const streamId = stream.id ?? "unknown";
  const lastObservedAt = lastObservedProgressAtByStream.get(streamId);

  const signal = classifyStreamProgressOutcome(
    stream,
    at,
    lastObservedAt,
    latencyMs,
  );

  // Update in-memory observation tracker
  if (stream.id) {
    if (lastObservedAt === undefined || at >= lastObservedAt) {
      lastObservedProgressAtByStream.set(stream.id, at);
    }
  }

  // Update Prometheus metrics
  streamProgressOutcomeGauge.set(signal.outcomeCode);
  streamProgressClockSkewGauge.set(signal.clockSkewSeconds);

  if (signal.clockSkewSeconds > 0) {
    streamProgressClockSkewTotal.inc();

    // Emit structured log linking streamId and correlationId without wallet secrets
    logger.warn(
      {
        event: "stream_progress_clock_skew",
        streamId: signal.streamId,
        outcome: signal.outcome,
        outcomeCode: signal.outcomeCode,
        clockSkewSeconds: signal.clockSkewSeconds,
        latencyMs: signal.latencyMs,
        calculatedAt: signal.calculatedAt,
        referenceAt: signal.referenceAt,
        isNormalEmpty: signal.isNormalEmpty,
      },
      signal.detail,
    );
  }

  lastPublishedSignal = signal;
  return signal;
}
