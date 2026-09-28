import { indexerOutcome as indexerOutcomeGauge } from "./metrics";
import {
  CircuitState,
  getIndexerMonitoringSnapshot,
  type IndexerMonitoringSnapshot,
  type IndexerRpcFailureKind,
} from "./indexer";

/**
 * Coarse, secret-free monitoring outcome for the event indexer.
 *
 * Mirrors the webhook delivery outcome signal (`WebhookDeliveryOutcome`) so both
 * operational pipelines share the same three-way vocabulary:
 *
 * - `success` — the circuit is CLOSED, the last poll completed, and the
 *   checkpoint is current.
 * - `transient_delay` — a poll hit a retryable RPC condition (rate limit or
 *   disconnection) but the retry budget is intact, or the breaker is HALF_OPEN
 *   probing recovery; the next scheduled poll resolves it without an owner.
 * - `blocked` — the retry budget is exhausted (circuit OPEN) or work is
 *   outstanding with no RPC endpoint/contract configured; an owner must act.
 */
export type IndexerMonitoringOutcome = "success" | "transient_delay" | "blocked";

/**
 * Stable numeric encoding for the Prometheus gauge and for alert rules.
 * Do not renumber: dashboards and alerts key off these values.
 */
export const INDEXER_OUTCOME_CODES: Record<IndexerMonitoringOutcome, number> = {
  success: 0,
  transient_delay: 1,
  blocked: 2,
};

export interface IndexerOutcomeSignal {
  outcome: IndexerMonitoringOutcome;
  outcomeCode: number;
  /**
   * Owner-actionable explanation. Deliberately carries only ledgers, counts and
   * enumerated state: never the RPC URL, contract ID, credentials, or a raw
   * provider message, so it is safe to log, scrape, and paste into an incident
   * channel.
   */
  detail: string;
  state: IndexerMonitoringSnapshot;
}

/**
 * Turns an enumerated failure kind into prose. The raw provider error is never
 * replayed here: messages can embed a URL or credential.
 */
function describeFailureKind(kind: IndexerRpcFailureKind | null): string {
  switch (kind) {
    case "rate_limited":
      return "the provider reported a rate limit";
    case "disconnected":
      return "the RPC connection failed or timed out";
    case "provider_error":
      return "the provider returned an error response";
    default:
      return "the poll failed";
  }
}

/**
 * Classifies an indexer snapshot into the three operational outcomes.
 *
 * Precedence matters: an exhausted retry budget (`blocked`) outranks any
 * backlog, because a provider that keeps failing needs a human before more
 * polls are worth spending. A circuit still closed with failures recorded — or
 * a HALF_OPEN probe in flight — is `transient_delay`: normal, self-healing
 * behaviour that must not page anyone.
 */
export function classifyIndexerOutcome(
  snapshot: IndexerMonitoringSnapshot,
): IndexerOutcomeSignal {
  let outcome: IndexerMonitoringOutcome;
  let detail: string;

  if (snapshot.circuitState === CircuitState.OPEN) {
    outcome = "blocked";
    detail =
      `RPC polling is blocked: ${snapshot.consecutiveFailures} consecutive poll ` +
      `failure(s) reached the ${snapshot.failureThreshold}-failure threshold and ` +
      `opened the circuit (${describeFailureKind(snapshot.lastFailureKind)}). ` +
      `Owner action: verify RPC availability and provider rate-limit status, ` +
      `restore network access or reduce competing RPC traffic, and let the ` +
      `scheduled half-open probe recover the circuit. Do not restart in a loop.`;
  } else if (
    !snapshot.rpcConfigured &&
    (snapshot.ledgerLag > 0 || snapshot.consecutiveFailures > 0)
  ) {
    outcome = "blocked";
    detail =
      `${snapshot.ledgerLag} ledger(s) remain unindexed but no RPC endpoint or ` +
      `contract is configured. Owner action: set the Stellar RPC URL and contract ` +
      `ID, then restart the service once.`;
  } else if (snapshot.circuitState === CircuitState.HALF_OPEN) {
    outcome = "transient_delay";
    detail =
      `Recovery probe in progress after ${snapshot.consecutiveFailures} consecutive ` +
      `poll failure(s) (${describeFailureKind(snapshot.lastFailureKind)}). The retry ` +
      `budget is spent but the single half-open probe is allowed. Owner action: none ` +
      `while the probe succeeds; act only if the circuit reopens.`;
  } else if (snapshot.consecutiveFailures > 0) {
    outcome = "transient_delay";
    detail =
      `${snapshot.consecutiveFailures} consecutive poll failure(s) ` +
      `(${describeFailureKind(snapshot.lastFailureKind)}); the retry budget is ` +
      `intact (${snapshot.consecutiveFailures}/${snapshot.failureThreshold}). The ` +
      `next scheduled poll retries automatically. Owner action: none while failures ` +
      `stay below the threshold.`;
  } else if (snapshot.latestLedger === null) {
    outcome = "success";
    detail =
      `No RPC head has been observed yet and ${snapshot.ledgerLag} ledger(s) are ` +
      `outstanding. Nothing is blocked.`;
  } else {
    outcome = "success";
    detail =
      `RPC reached at ledger ${snapshot.latestLedger}; the checkpoint is ` +
      `${snapshot.ledgerLag} ledger(s) behind. Polls are completing normally and no ` +
      `owner action is required.`;
  }

  return {
    outcome,
    outcomeCode: INDEXER_OUTCOME_CODES[outcome],
    detail,
    state: snapshot,
  };
}

/** Current outcome signal for the indexer. */
export function getIndexerOutcomeSignal(
  snapshot: IndexerMonitoringSnapshot = getIndexerMonitoringSnapshot(),
): IndexerOutcomeSignal {
  return classifyIndexerOutcome(snapshot);
}

/**
 * Publishes the current outcome to Prometheus so alerting does not have to
 * re-derive it from `indexer_circuit_state` and `indexer_errors_total`.
 */
export function refreshIndexerMetrics(
  snapshot: IndexerMonitoringSnapshot = getIndexerMonitoringSnapshot(),
): IndexerOutcomeSignal {
  const signal = getIndexerOutcomeSignal(snapshot);
  indexerOutcomeGauge.set(signal.outcomeCode);
  return signal;
}
