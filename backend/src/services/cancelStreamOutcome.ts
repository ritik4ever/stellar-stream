import { logger } from "../logger";

export type CancelStreamOutcome =
  | "success"
  | "already_canceled"
  | "already_completed"
  | "racing_claim"
  | "failure";

export const CANCEL_STREAM_OUTCOME_CODES: Record<CancelStreamOutcome, number> = {
  success: 0,
  already_canceled: 1,
  already_completed: 2,
  racing_claim: 3,
  failure: 4,
};

export interface CancelStreamOutcomeSignal {
  outcome: CancelStreamOutcome;
  outcomeCode: number;
  /** Actionable operator explanation. Never carries secret keys or credentials. */
  detail: string;
  /** Distinguishes normal idempotent / empty cases from failures. */
  isNormalEmpty: boolean;
  /** Indicates whether a concurrent claim raced during the cancellation flow. */
  isRacingClaim: boolean;
  /** Indicates whether the committed record was already canceled when this request arrived. */
  isRepeatedCancel: boolean;
  latencyMs: number;
  streamId: string;
  sender?: string;
  recipient?: string;
  canceledAt?: number;
  refundedAmount?: number;
  requestId?: string;
  correlationId?: string;
}

let lastPublishedSignal: CancelStreamOutcomeSignal | null = null;

export function emitCancelStreamSignal(
  signal: Omit<CancelStreamOutcomeSignal, "outcomeCode">,
): CancelStreamOutcomeSignal {
  const fullSignal: CancelStreamOutcomeSignal = {
    ...signal,
    outcomeCode: CANCEL_STREAM_OUTCOME_CODES[signal.outcome],
  };

  lastPublishedSignal = fullSignal;

  if (fullSignal.outcome === "failure") {
    logger.error(
      {
        event: "cancel_stream_failure",
        ...fullSignal,
      },
      fullSignal.detail,
    );
  } else {
    logger.info(
      {
        event: "cancel_stream_signal",
        ...fullSignal,
      },
      fullSignal.detail,
    );
  }

  return fullSignal;
}

export function getLastPublishedCancelStreamSignal(): CancelStreamOutcomeSignal | null {
  return lastPublishedSignal;
}

export function resetCancelStreamSignalForTesting(): void {
  lastPublishedSignal = null;
}
