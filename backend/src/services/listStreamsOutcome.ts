import { logger } from "../logger";

export type ListStreamsOutcome = "success" | "transient_delay" | "failure";

export const LIST_STREAMS_OUTCOME_CODES: Record<ListStreamsOutcome, number> = {
  success: 0,
  transient_delay: 1,
  failure: 2,
};

export interface ListStreamsOutcomeSignal {
  outcome: ListStreamsOutcome;
  outcomeCode: number;
  /** Actionable operator explanation. Never carries secret keys or credentials. */
  detail: string;
  /**
   * Distinguishes normal empty query results from database read failures.
   */
  isNormalEmpty: boolean;
  latencyMs: number;
  page: number;
  limit: number;
  total: number;
  returnedCount: number;
  requestId?: string;
  correlationId?: string;
  streamId?: string;
}

let lastPublishedSignal: ListStreamsOutcomeSignal | null = null;

export function emitListStreamsSignal(
  signal: Omit<ListStreamsOutcomeSignal, "outcomeCode">,
): ListStreamsOutcomeSignal {
  const fullSignal: ListStreamsOutcomeSignal = {
    ...signal,
    outcomeCode: LIST_STREAMS_OUTCOME_CODES[signal.outcome],
  };

  lastPublishedSignal = fullSignal;

  if (fullSignal.outcome === "failure") {
    logger.error(
      {
        event: "list_streams_failure",
        ...fullSignal,
      },
      fullSignal.detail,
    );
  } else {
    logger.info(
      {
        event: "list_streams_query",
        ...fullSignal,
      },
      fullSignal.detail,
    );
  }

  return fullSignal;
}

export function getLastPublishedListStreamsSignal(): ListStreamsOutcomeSignal | null {
  return lastPublishedSignal;
}

export function resetListStreamsSignalForTesting(): void {
  lastPublishedSignal = null;
}
