import { logger } from "../logger";

export type CreateStreamOutcome =
  | "success"
  | "idempotent_replay"
  | "concurrent_conflict"
  | "validation_error"
  | "failure";

export const CREATE_STREAM_OUTCOME_CODES: Record<CreateStreamOutcome, number> = {
  success: 0,
  idempotent_replay: 1,
  concurrent_conflict: 2,
  validation_error: 3,
  failure: 4,
};

export interface CreateStreamOutcomeSignal {
  outcome: CreateStreamOutcome;
  outcomeCode: number;
  /** Actionable operator explanation. Never carries secret keys or credentials. */
  detail: string;
  /** Distinguishes normal idempotent / empty cases from failures. */
  isNormalEmpty: boolean;
  /** Indicates whether two identical requests arrived together. */
  isConcurrentConflict: boolean;
  /** Indicates whether this was an idempotent replay after a client timeout. */
  isIdempotentReplay: boolean;
  latencyMs: number;
  streamId?: string;
  sender?: string;
  recipient?: string;
  idempotencyKey?: string;
  requestId?: string;
  correlationId?: string;
}

let lastPublishedSignal: CreateStreamOutcomeSignal | null = null;

export function emitCreateStreamSignal(
  signal: Omit<CreateStreamOutcomeSignal, "outcomeCode">,
): CreateStreamOutcomeSignal {
  const fullSignal: CreateStreamOutcomeSignal = {
    ...signal,
    outcomeCode: CREATE_STREAM_OUTCOME_CODES[signal.outcome],
  };

  lastPublishedSignal = fullSignal;

  if (fullSignal.outcome === "failure") {
    logger.error(
      {
        event: "create_stream_failure",
        ...fullSignal,
      },
      fullSignal.detail,
    );
  } else if (fullSignal.outcome === "concurrent_conflict") {
    logger.warn(
      {
        event: "create_stream_conflict",
        ...fullSignal,
      },
      fullSignal.detail,
    );
  } else {
    logger.info(
      {
        event: "create_stream_signal",
        ...fullSignal,
      },
      fullSignal.detail,
    );
  }

  return fullSignal;
}

export function getLastPublishedCreateStreamSignal(): CreateStreamOutcomeSignal | null {
  return lastPublishedSignal;
}

export function resetCreateStreamSignalForTesting(): void {
  lastPublishedSignal = null;
}
