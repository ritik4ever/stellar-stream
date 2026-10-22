import { logger } from "../logger";
import {
  assetAllowlistDuplicatesTotal,
  assetAllowlistLatencyMs as assetAllowlistLatencyMsGauge,
  assetAllowlistOutcome as assetAllowlistOutcomeGauge,
} from "./metrics";
import { ASSET_CODE_REGEX } from "../validation/schemas";

/**
 * Coarse, secret-free outcome for the Asset allowlist configuration and endpoints.
 *
 * - `success` (0) — Allowlist configuration is valid; duplicate and mixed-case asset codes
 *   have been normalized and deduplicated; or a query returned a normal empty/populated set.
 * - `transient_delay` (1) — Temporary storage/database lock or retryable delay occurred while
 *   evaluating or updating allowlist assets.
 * - `blocked` (2) — Invalid configuration on startup (e.g., empty asset list, malformed codes,
 *   or invalid asset syntax). Operator action required to fix environment configuration.
 */
export type AssetAllowlistOutcome = "success" | "transient_delay" | "blocked";

/**
 * Stable numeric encoding for the Prometheus gauge and alert rules.
 */
export const ASSET_ALLOWLIST_OUTCOME_CODES: Record<AssetAllowlistOutcome, number> = {
  success: 0,
  transient_delay: 1,
  blocked: 2,
};

export interface AssetAllowlistOutcomeSignal {
  outcome: AssetAllowlistOutcome;
  outcomeCode: number;
  /**
   * Actionable operator explanation. Never carries wallet secrets, seeds, or credentials.
   */
  detail: string;
  /**
   * True only for a normal empty list (e.g. valid clean store or empty query results),
   * distinguishing normal empty state from startup configuration failures.
   */
  isNormalEmpty: boolean;
  /** Evaluation latency in milliseconds. */
  latencyMs: number;
  /** Normalized, deduplicated unique asset codes. */
  configuredAssets: string[];
  /** Total count of raw comma-separated items passed. */
  rawAssetsCount: number;
  /** Number of unique valid assets after normalization. */
  uniqueAssetsCount: number;
  /** Number of duplicate codes stripped. */
  duplicateCount: number;
  /** Whether any malformed/invalid asset codes were encountered. */
  hasInvalidCodes: boolean;
  requestId?: string;
  correlationId?: string;
  streamId?: string;
}

let lastPublishedSignal: AssetAllowlistOutcomeSignal | null = null;

/**
 * Retrieve the most recently emitted asset allowlist outcome signal.
 */
export function getLastAssetAllowlistSignal(): AssetAllowlistOutcomeSignal | null {
  return lastPublishedSignal;
}

/**
 * Reset in-memory state and gauges (used for test hygiene).
 */
export function resetAssetAllowlistOutcome(): void {
  lastPublishedSignal = null;
  assetAllowlistOutcomeGauge.set(ASSET_ALLOWLIST_OUTCOME_CODES.success);
  assetAllowlistLatencyMsGauge.set(0);
}

/**
 * Evaluates, normalizes, and deduplicates raw asset codes from configuration or requests,
 * surfacing structured outcome and latency signals.
 *
 * Boundary semantics (documented, deterministic):
 * - Asset codes are trimmed, uppercased (mixed-case normalized), and deduplicated in first-seen
 *   order. The resulting `validAssets` list is stable and never silently reordered.
 * - Duplicates (including mixed-case variants of the same code) are stripped and counted;
 *   this is a `success` outcome.
 * - Empty tokens and malformed codes are treated as invalid configuration (`blocked`).
 */
export function evaluateAssetAllowlistConfig(
  rawInput: string | undefined,
  context?: {
    requestId?: string;
    correlationId?: string;
    streamId?: string;
    startPerf?: number;
    allowEmpty?: boolean;
  },
): {
  validAssets: string[];
  signal: AssetAllowlistOutcomeSignal;
} {
  const start = context?.startPerf ?? date.now();
  const rawString = typeof rawInput === "string" ? rawInput.trim() : "";
  const allowEmpty = context?.allowEmpty ?? false;

  let rawTokens: string[] = [];
  if (rawString.length > 0) {
    rawTokens = rawString.split(",").map((token) => token.trim());
  }

  const seen = new Set<string>();
  const validAssets: string[] = [];
  let duplicateCount = 0;
  let hasInvalidCodes = false;

  for (const token of rawTokens) {
    if (token.length === 0) {
      hasInvalidCodes = true;
      continue;
    }
    const normalized = token.toUpperCase();
    if (!ASSET_CODE_REGEX.test(normalized)) {
      hasInvalidCodes = true;
      continue;
    }
    if (seen.has(normalized)) {
      duplicateCount++;
      assetAllowlistDuplicatesTotal.inc();
    } else {
      seen.add(normalized);
      validAssets.push(normalized);
    }
  }

  const latencyMs = Math.max(0, Date.now() - start);

  let outcome: AssetAllowlistOutcome;
  let detail: string;
  let isNormalEmpty = false;

  if (rawString.length === 0) {
    if (allowEmpty) {
      outcome = "success";
      isNormalEmpty = true;
      detail = "Normal empty asset allowlist configuration.";
    } else {
      outcome = "blocked";
      isNormalEmpty = false;
      detail = "Invalid configuration on startup: ALLOWED_ASSETS must contain at least one asset code.";
    }
  } else if (hasInvalidCodes && validAssets.length === 0) {
    outcome = "blocked";
    isNormalEmpty = false;
    detail = "Invalid configuration on startup: all provided asset codes failed validation (must be 1–12 alphanumeric characters).";
  } else if (hasInvalidCodes) {
    outcome = "blocked";
    isNormalEmpty = false;
    detail = `Invalid configuration on startup: contains malformed asset codes alongside ${validAssets.length} valid asset(s).`;
  } else {
    outcome = "success";
    isNormalEmpty = validAssets.length === 0;
    detail = duplicateCount > 0
      ? `Successfully loaded ${validAssets.length} unique asset(s) with ${duplicateCount} duplicate(s) stripped and mixed-case normalized.`
      : `Successfully loaded ${validAssets.length} asset(s).`;
  }

  const signal: AssetAllowlistOutcomeSignal = {
    outcome,
    outcomeCode: ASSET_ALLOWLIST_OUTCOME_CODES[outcome],
    detail,
    isNormalEmpty,
    latencyMs,
    configuredAssets: validAssets,
    rawAssetsCount: rawTokens.length,
    uniqueAssetsCount: validAssets.length,
    duplicateCount,
    hasInvalidCodes,
    requestId: context?.requestId,
    correlationId: context?.correlationId,
    streamId: context?.streamId,
  };

  recordAssetAllowlistOutcome(signal);
  return { validAssets, signal };
}

/**
 * Updates Prometheus metrics with the latest signal.
 */
export function refreshAssetAllowlistMetrics(signal: AssetAllowlistOutcomeSignal): void {
  assetAllowlistOutcomeGauge.set(signal.outcomeCode);
  assetAllowlistLatencyMsGauge.set(signal.latencyMs);
}

/**
 * Emits structured log and records the signal.
 */
export function recordAssetAllowlistOutcome(signal: AssetAllowlistOutcomeSignal): void {
  lastPublishedSignal = signal;
  refreshAssetAllowlistMetrics(signal);

  const logPayload = {
    event: "asset_allowlist_config",
    outcome: signal.outcome,
    outcomeCode: signal.outcomeCode,
    detail: signal.detail,
    latencyMs: signal.latencyMs,
    isNormalEmpty: signal.isNormalEmpty,
    uniqueAssetsCount: signal.uniqueAssetsCount,
    duplicateCount: signal.duplicateCount,
    hasInvalidCodes: signal.hasInvalidCodes,
    requestId: signal.requestId,
    correlation_id: signal.correlationId,
    streamId: signal.streamId,
  };

  if (signal.outcome === "blocked") {
    logger.warn(logPayload, `Asset allowlist configuration failure: ${signal.detail}`);
  } else if (signal.outcome === "transient_delay") {
    logger.warn(logPayload, `Asset allowlist configuration transient delay: ${signal.detail}`);
  } else {
    logger.info(logPayload, `Asset allowlist configuration evaluated: ${signal.detail}`);
  }
}
