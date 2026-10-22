import { describe, it, expect, beforeEach } from "vitest";
import {
  evaluateAssetAllowlistConfig,
  getLastAssetAllowlistSignal,
  resetAssetAllowlistOutcome,
  ASSET_ALLOWLIST_OUTCOME_CODES,
} from "./services/assetAllowlistOutcome";
import {
  assetAllowlistOutcome,
  assetAllowlistLatencyMs,
} from "./services/metrics";

describe("Asset allowlist outcome signals & boundary normalization (SSB-2026-121 / #1067)", () => {
  beforeEach(() => {
    resetAssetAllowlistOutcome();
  });

  describe("Duplicate & mixed-case asset code normalization", () => {
    it("deduplicates redundant codes and normalizes mixed-case to uppercase", () => {
      const raw = "usdc, XLM, Usdc, xlm, btc, BTC, eth, Eth";
      const { validAssets, signal } = evaluateAssetAllowlistConfig(raw);

      expect(validAssets).toEqual(["USDC", "XLM", "BTC", "ETH"]);
      expect(signal.outcome).toBe("success");
      expect(signal.outcomeCode).toBe(ASSET_ALLOWLIST_OUTCOME_CODES.success);
      expect(signal.uniqueAssetsCount).toBe(4);
      expect(signal.duplicateCount).toBe(4);
      expect(signal.rawAssetsCount).toBe(8);
      expect(signal.hasInvalidCodes).toBe(false);
      expect(signal.isNormalEmpty).toBe(false);
      expect(signal.detail).toContain("duplicate(s) stripped");
    });

    it("trims whitespace around codes properly", () => {
      const raw = "   usdc   ,   xlm   ";
      const { validAssets, signal } = evaluateAssetAllowlistConfig(raw);

      expect(validAssets).toEqual(["USDC", "XLM"]);
      expect(signal.duplicateCount).toBe(0);
      expect(signal.outcome).toBe("success");
    });

    it("preserves normalized sorted asset list order deterministically across duplicate inputs", () => {
      const a = evaluateAssetAllowlistConfig("XLM,USDC,XLM,USDC");
      resetAssetAllowlistOutcome();
      const b = evaluateAssetAllowlistConfig("xlm,usdc,Xlm,Usdc");

      expect(a.validAssets).toEqual(["XLM", "USDC"]);
      expect(b.validAssets).toEqual(a.validAssets);
      expect(a.signal.outcomeCode).toBe(b.signal.outcomeCode);
    });

    it("treats duplicate-only mixed-case input as success with stable outcome", () => {
      const { validAssets, signal } = evaluateAssetAllowlistConfig("usdc,USDC,Usdc");

      expect(validAssets).toEqual(["USDC"]);
      expect(signal.outcomeCode).toBe(ASSET_ALLOWLIST_OUTCOME_CODES.success);
      expect(signal.duplicateCount).toBe(2);
    });
  });

  describe("Invalid configuration on startup", () => {
    it("emits blocked outcome signal when ALLOWED_ASSETS is empty", () => {
      const { validAssets, signal } = evaluateAssetAllowlistConfig("");

      expect(validAssets).toEqual([]);
      expect(signal.outcome).toBe("blocked");
      expect(signal.outcomeCode).toBe(ASSET_ALLOWLIST_OUTCOME_CODES.blocked);
      expect(signal.isNormalEmpty).toBe(false);
      expect(signal.detail).toContain("must contain at least one asset code");
    });

    it("emits blocked outcome signal when asset codes violate length or character constraints", () => {
      const raw = "USDC,TOOLONGASSETCODE123,VALID,RNVALID$CODE";
      const { validAssets, signal } = evaluateAssetAllowlistConfig(raw);

      expect(validAssets).toEqual(["USDC", "VALID"]);
      expect(signal.outcome).toBe("blocked");
      expect(signal.outcomeCode).toBe(ASSET_ALLOWLIST_OUTCOME_CODES.blocked);
      expect(signal.hasInvalidCodes).toBe(true);
      expect(signal.isNormalEmpty).toBe(false);
      expect(signal.detail).toContain("malformed asset codes");
    });

    it("emits blocked outcome when all codes are invalid", () => {
      const raw = "!@#$,$$$,&&&&";
      const { validAssets, signal } = evaluateAssetAllowlistConfig(raw);

      expect(validAssets).toHaveLength(0);
      expect(signal.outcome).toBe("blocked");
      expect(signal.outcomeCode).toBe(ASSET_ALLOWLIST_OUTCOME_CODES.blocked);
      expect(signal.hasInvalidCodes).toBe(true);
      expect(signal.isNormalEmpty).toBe(false);
    });

    it("emits blocked outcome when invalid codes are mixed with duplicates", () => {
      const raw = "USDC,usdc,TOOLONGASSETCODE123,USDC";
      const { validAssets, signal } = evaluateAssetAllowlistConfig(raw);

      expect(validAssets).toEqual(["USDC"]);
      expect(signal.outcomeCode).toBe(ASSET_ALLOWLIST_OUTCOME_CODES.blocked);
      expect(signal.hasInvalidCodes).toBe(true);
      expect(signal.duplicateCount).toBe(2);
    });
  });

  describe("Distinguishing normal empty cases from failure", () => {
    it("distinguishes legitimate empty state from startup configuration error", () => {
      // Normal empty case (e.g. query on clean allowlist state with allowEmpty=true)
      const emptyResult = evaluateAssetAllowlistConfig("", { allowEmpty: true });
      expect(emptyResult.signal.isNormalEmpty).toBe(true);
      expect(emptyResult.signal.outcome).toBe("success");
      expect(emptyResult.signal.outcomeCode).toBe(0);

      // Failure state (startup misconfiguration without allowEmpty)
      const failureResult = evaluateAssetAllowlistConfig("", { allowEmpty: false });
      expect(failureResult.signal.isNormalEmpty).toBe(false);
      expect(failureResult.signal.outcome).toBe("blocked");
      expect(failureResult.signal.outcomeCode).toBe(2);
    });
  });

  describe("Actionable latency and correlation linking", () => {
    it("records non-negative latency and links requestId, correlationId, and streamId", () => {
      const { signal } = evaluateAssetAllowlistConfig("uSDC,XLM", {
        requestId: "req-12345",
        correlationId: "corr-67890",
        streamId: "stream-abc",
      });

      expect(signal.latencyMs).toBeGreaterThanOrEqual(0);
      expect(signal.requestId).toBe("req-12345");
      expect(signal.correlationId).toBe("corr-67890");
      expect(signal.streamId).toBe("stream-abc");
    });

    it("publishes and updates Prometheus outcome and latency gauges", async () => {
      evaluateAssetAllowlistConfig("USDC,XLM,EURC");

      const lastSignal = getLastAssetAllowlistSignal();
      expect(lastSignal).not.toBeNull();
      expect(lastSignal?.outcome).toBe("success");

      const metricValue = await assetAllowlistOutcome.get();
      expect(metricValue.values[0].value).toBe(0);

      const latencyMetric = await assetAllowlistLatencyMs.get();
      expect(latencyMetric.values[0].value).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Privacy & zero credential leakage", () => {
    it("does not leak secret keys or sensitive tokens into signals or details", () => {
      // Even if a user inadvertently passes an invalid secret seed in place of an asset code
      const secretSeed = "SBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
      const { signal } = evaluateAssetAllowlistConfig(`USDC,${secretSeed}`);

      expect(signal.outcome).toBe("blocked");
      expect(signal.detail).not.toContain(secretSeed);
      expect(signal.configuredAssets).not.toContain(secretSeed);
    });
  });
});
