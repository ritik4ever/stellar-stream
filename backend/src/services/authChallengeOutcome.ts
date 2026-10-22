import { logger } from "../logger";
import {
  authChallengeOutcome as authChallengeOutcomeGauge,
  authChallengeDurationSeconds as authChallengeDurationGauge,
  authChallengeWrongNetworkTotal,
  authChallengeReplayTotal,
} from "./metrics";

/**
 * Coarse, secret-free outcome classification for the Authentication challenge workflow.
 *
 * - `success` (0) — Normal challenge verification succeeded, or normal empty state
 *   (e.g. unfunded account falling back to single-signer).
 * - `transient_delay` (1) — Challenge expired (timestamp drift or TimeBounds exceeded).
 *   Self-healing without operator intervention; user merely needs to request a new challenge.
 * - `blocked` (2) — Actionable failure requiring user/operator intervention:
 *   - Wallet signed for the wrong network (e.g. Mainnet instead of Testnet).
 *   - Reused nonce (replay attack detected).
 *   - Invalid signature or malformed challenge.
 */
export type AuthChallengeOutcome = "success" | "transient_delay" | "blocked";

/**
 * Numeric code mapping for Prometheus gauge and alert rules.
 */
export const AUTH_CHALLENGE_OUTCOME_CODES: Record<AuthChallengeOutcome, number> = {
  success: 0,
  transient_delay: 1,
  blocked: 2,
};

export type AuthChallengeOutcomeReason =
  | "success"
  | "normal_empty_account"
  | "expired_nonce"
  | "reused_nonce"
  | "wrong_network"
  | "invalid_signature"
  | "malformed_challenge";

export interface AuthChallengeOutcomeSignal {
  outcome: AuthChallengeOutcome;
  outcomeCode: number;
  reason: AuthChallengeOutcomeReason;
  /**
   * Actionable diagnostic explanation. Contains only public IDs, network names,
   * counts, and timestamps: NEVER private keys, seed phrases, or user credentials.
   */
  detail: string;
  /**
   * True only for normal empty account fallback (e.g. unfunded Stellar account
   * having 0 signers on Horizon, safely defaulting to single-signer).
   * Distinguishes expected empty conditions from operational failures.
   */
  isNormalEmpty: boolean;
  /** Verification duration in milliseconds. */
  latencyMs: number;
  /** Public Stellar account ID (G...), never private key (S...). */
  accountId?: string;
  /** Expected server network passphrase. */
  expectedNetwork?: string;
  /** Candidate network detected from wallet signature when wrong network was used. */
  detectedNetwork?: string;
  /** Correlation/request ID from AsyncLocalStorage or request context. */
  correlation_id?: string;
  /** Stream ID if authentication was triggered in context of a stream action. */
  streamId?: string;
}

let lastSignal: AuthChallengeOutcomeSignal | null = null;

/**
 * Test helper: resets in-memory outcome state and Prometheus gauges between runs.
 */
export function resetAuthChallengeOutcome(): void {
  lastSignal = null;
  authChallengeOutcomeGauge.set(AUTH_CHALLENGE_OUTCOME_CODES.success);
  authChallengeDurationGauge.set(0);
}

/**
 * Returns the most recently emitted authentication challenge signal.
 */
export function getLastAuthChallengeSignal(): AuthChallengeOutcomeSignal | null {
  return lastSignal;
}

/**
 * Records and publishes an authentication challenge outcome signal to Prometheus and logs.
 */
export function recordAuthChallengeOutcome(signal: AuthChallengeOutcomeSignal): void {
  lastSignal = signal;

  // Update Prometheus metrics
  authChallengeOutcomeGauge.set(signal.outcomeCode);
  authChallengeDurationGauge.set(signal.latencyMs / 1000);

  if (signal.reason === "wrong_network") {
    authChallengeWrongNetworkTotal.inc();
  } else if (signal.reason === "reused_nonce") {
    authChallengeReplayTotal.inc();
  }

  // Structured logging with context linking (request / stream ID)
  const logContext: Record<string, unknown> = {
    event: "auth_challenge_outcome",
    outcome: signal.outcome,
    outcomeCode: signal.outcomeCode,
    reason: signal.reason,
    isNormalEmpty: signal.isNormalEmpty,
    latencyMs: signal.latencyMs,
  };

  if (signal.accountId) logContext.accountId = signal.accountId;
  if (signal.expectedNetwork) logContext.expectedNetwork = signal.expectedNetwork;
  if (signal.detectedNetwork) logContext.detectedNetwork = signal.detectedNetwork;
  if (signal.correlation_id) logContext.correlation_id = signal.correlation_id;
  if (signal.streamId) logContext.streamId = signal.streamId;

  if (signal.outcome === "blocked") {
    logger.warn(logContext, `Auth challenge failed: ${signal.detail}`);
  } else if (signal.outcome === "transient_delay") {
    logger.info(logContext, `Auth challenge transient delay: ${signal.detail}`);
  } else {
    logger.info(logContext, `Auth challenge succeeded: ${signal.detail}`);
  }
}
