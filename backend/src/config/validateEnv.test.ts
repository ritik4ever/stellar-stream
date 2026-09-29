import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateEnv, redactUrlForConfigLog } from "./validateEnv";

// ---------------------------------------------------------------------------
// Mock the logger so we can assert on log calls without depending on pino's
// transport or console output.  The module is mocked before any test imports
// validateEnv, ensuring module-level logger usage is captured too.
// ---------------------------------------------------------------------------
vi.mock("../logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  redactObject: (v: unknown) => v,
  STELLAR_SECRET_REGEX: /^S[0-9A-Z]{55}$/,
}));

// Import the mocked logger so tests can inspect calls.
import { logger } from "../logger";

describe("validateEnv", () => {
  const originalEnv = process.env;
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

  // Typed shorthand refs to the mocked logger methods.
  const loggerErrorSpy = logger.error as ReturnType<typeof vi.fn>;
  const loggerWarnSpy = logger.warn as ReturnType<typeof vi.fn>;
  const loggerInfoSpy = logger.info as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    exitSpy.mockClear();
    loggerErrorSpy.mockClear();
    loggerWarnSpy.mockClear();
    loggerInfoSpy.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ---------------------------------------------------------------------------
  // Helper: asserts no logger call contains a hidden value (e.g. a secret key)
  // ---------------------------------------------------------------------------
  function assertNoLoggerOutputContains(hiddenValue: string) {
    const allCalls = [
      ...loggerErrorSpy.mock.calls,
      ...loggerWarnSpy.mock.calls,
      ...loggerInfoSpy.mock.calls,
    ];
    for (const args of allCalls) {
      const output = args.map((a: unknown) => JSON.stringify(a)).join(" ");
      expect(output).not.toContain(hiddenValue);
    }
  }

  // ---------------------------------------------------------------------------
  // Acceptance Criteria 1: Invalid config fails fast with helpful messages
  // ---------------------------------------------------------------------------
  describe("Acceptance Criteria 1: Invalid config fails fast with helpful messages", () => {
    it("should exit with code 1 when CONTRACT_ID is missing and Soroban enabled", () => {
      process.env = {
        SERVER_PRIVATE_KEY: "S" + "A".repeat(55),
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
      // Implementation logs: "❌ Soroban configuration incomplete..."
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Soroban configuration incomplete"),
      );
    });

    it("should exit with code 1 when SERVER_PRIVATE_KEY is missing and Soroban enabled", () => {
      process.env = {
        CONTRACT_ID: "C" + "A".repeat(55),
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
      // Implementation logs: "❌ Soroban configuration incomplete..."
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Soroban configuration incomplete"),
      );
    });

    it("should exit with code 1 when CONTRACT_ID format is invalid (not starting with C)", () => {
      process.env = {
        CONTRACT_ID: "G" + "A".repeat(55), // 56 chars, starts with G
        SERVER_PRIVATE_KEY: "S" + "A".repeat(55), // 56 chars, starts with S
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
      // Implementation logs: "CONTRACT_ID validation failed"
      expect(loggerErrorSpy).toHaveBeenCalledWith("CONTRACT_ID validation failed");
    });

    it("should exit with code 1 when SERVER_PRIVATE_KEY format is invalid (not starting with S)", () => {
      process.env = {
        CONTRACT_ID: "C" + "A".repeat(55),
        SERVER_PRIVATE_KEY: "G" + "A".repeat(55), // starts with G
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
      // Implementation logs: "SERVER_PRIVATE_KEY validation failed"
      expect(loggerErrorSpy).toHaveBeenCalledWith("SERVER_PRIVATE_KEY validation failed");
    });

    it("should exit with code 1 when RPC_URL is invalid", () => {
      const badUrl = "not-a-valid-url";
      process.env = {
        CONTRACT_ID: "C" + "A".repeat(55),
        SERVER_PRIVATE_KEY: "S" + "A".repeat(55),
        RPC_URL: badUrl,
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
      // Implementation logs: { rpcUrl: badUrl }, "RPC_URL validation failed"
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ rpcUrl: badUrl }),
        "RPC_URL validation failed",
      );
    });

    it("should provide helpful error message listing required keys", () => {
      process.env = {
        // missing CONTRACT_ID
        SERVER_PRIVATE_KEY: "S" + "A".repeat(55),
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
      // Implementation logs: "required for on-chain operations: CONTRACT_ID and SERVER_PRIVATE_KEY"
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("required for on-chain operations"),
      );
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("CONTRACT_ID"),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance Criteria 2: Optional vs required config clearly distinguished
  // ---------------------------------------------------------------------------
  describe("Acceptance Criteria 2: Optional vs required config clearly distinguished", () => {
    it("should allow missing optional variables with defaults when SOROBAN_DISABLED=true", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
      };

      const config = validateEnv();

      expect(config.port).toBe(3001);
      expect(config.rpcUrl).toBe("https://soroban-testnet.stellar.org:443");
      expect(config.networkPassphrase).toBe("Test SDF Network ; September 2015");
      expect(config.allowedAssets).toEqual(["USDC", "XLM"]);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("should require CONTRACT_ID and SERVER_PRIVATE_KEY when Soroban enabled", () => {
      process.env = {
        // missing both
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("should accept valid CONTRACT_ID and SERVER_PRIVATE_KEY", () => {
      process.env = {
        CONTRACT_ID: "C" + "A".repeat(55),
        SERVER_PRIVATE_KEY: "S" + "A".repeat(55),
      };

      validateEnv();

      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("should parse PORT as number", () => {
      process.env = {
        PORT: "5000",
        SOROBAN_DISABLED: "true",
      };

      const config = validateEnv();

      expect(config.port).toBe(5000);
      expect(typeof config.port).toBe("number");
    });

    it("should use default PORT when not provided", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
      };

      const config = validateEnv();

      expect(config.port).toBe(3001);
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance Criteria 3: Local non-chain development can run intentionally
  // ---------------------------------------------------------------------------
  describe("Acceptance Criteria 3: Local non-chain development can run intentionally", () => {
    it("should allow local development with SOROBAN_DISABLED=true", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
      };

      const config = validateEnv();

      expect(config.sorobanEnabled).toBe(false);
      expect(config.contractId).toBeNull();
      expect(config.serverPrivateKey).toBeNull();
      expect(exitSpy).not.toHaveBeenCalled();
      // Implementation logs: "Soroban disabled (SOROBAN_DISABLED=true) — local development mode"
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining("Soroban disabled"),
      );
    });

    it("should log info when Soroban is disabled", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
      };

      validateEnv();

      // Implementation: logger.info("Soroban disabled (SOROBAN_DISABLED=true) — local development mode")
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining("Soroban disabled"),
      );
    });

    it("should warn and not expose the private key when SOROBAN_DISABLED=true and SERVER_PRIVATE_KEY is configured", () => {
      const privateKey = "S" + "B".repeat(55);
      process.env = {
        SOROBAN_DISABLED: "true",
        SERVER_PRIVATE_KEY: privateKey,
      };

      const config = validateEnv();

      expect(config.sorobanEnabled).toBe(false);
      // serverPrivateKey is null when Soroban is disabled
      expect(config.serverPrivateKey).toBeNull();
      // Implementation: logger.warn("⚠️  SOROBAN_DISABLED=true is set and SERVER_PRIVATE_KEY is configured...")
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("SOROBAN_DISABLED=true is set and SERVER_PRIVATE_KEY is configured"),
      );
      assertNoLoggerOutputContains(privateKey);
    });

    it("should not require CONTRACT_ID/SERVER_PRIVATE_KEY when SOROBAN_DISABLED=true", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        PORT: "3001",
      };

      const config = validateEnv();

      expect(config.sorobanEnabled).toBe(false);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("should still validate other config even with SOROBAN_DISABLED=true", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        PORT: "invalid-port",
      };

      try {
        validateEnv();
      } catch (e) {
        // expected to throw or exit
      }

      expect(exitSpy).toHaveBeenCalledWith(1);
      // Implementation: logger.error({ issues: ... }, "environment validation failed")
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.anything(),
        "environment validation failed",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance Criteria 4: README stays aligned with validation rules
  // ---------------------------------------------------------------------------
  describe("Acceptance Criteria 4: README stays aligned with validation rules", () => {
    it("should validate ALLOWED_ASSETS from README section 8", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        ALLOWED_ASSETS: "USDC,XLM,EURC",
      };

      const config = validateEnv();

      expect(config.allowedAssets).toEqual(["USDC", "XLM", "EURC"]);
    });

    it("should use default ALLOWED_ASSETS from README", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
      };

      const config = validateEnv();

      expect(config.allowedAssets).toEqual(["USDC", "XLM"]);
    });

    it("should validate RPC_URL default from README", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
      };

      const config = validateEnv();

      expect(config.rpcUrl).toBe("https://soroban-testnet.stellar.org:443");
    });

    it("should validate NETWORK_PASSPHRASE default from README", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
      };

      const config = validateEnv();

      expect(config.networkPassphrase).toBe("Test SDF Network ; September 2015");
    });
  });

  // ---------------------------------------------------------------------------
  // Additional validation scenarios
  // ---------------------------------------------------------------------------
  describe("Additional validation scenarios", () => {
    it("should warn when WEBHOOK_DESTINATION_URL set without WEBHOOK_SIGNING_SECRET", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        WEBHOOK_DESTINATION_URL: "https://example.com/webhook",
      };

      validateEnv();

      // Implementation: logger.warn("⚠️  WEBHOOK_DESTINATION_URL is set but WEBHOOK_SIGNING_SECRET is not...")
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("WEBHOOK_SIGNING_SECRET is not"),
      );
    });

    it("should validate WEBHOOK_DESTINATION_URL format", () => {
      const badUrl = "not-a-url";
      process.env = {
        SOROBAN_DISABLED: "true",
        WEBHOOK_DESTINATION_URL: badUrl,
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
      // Implementation: logger.error({ webhookDestinationUrl: badUrl }, "WEBHOOK_DESTINATION_URL validation failed")
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ webhookDestinationUrl: badUrl }),
        "WEBHOOK_DESTINATION_URL validation failed",
      );
    });

    it("should exit with code 1 when ALLOWED_ASSETS is empty", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        ALLOWED_ASSETS: "",
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
      // Implementation: logger.error("ALLOWED_ASSETS must contain at least one asset code")
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        "ALLOWED_ASSETS must contain at least one asset code",
      );
    });

    it("should normalize asset codes to uppercase", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        ALLOWED_ASSETS: "usdc, xlm, eurc",
      };

      const config = validateEnv();

      expect(config.allowedAssets).toEqual(["USDC", "XLM", "EURC"]);
    });

    it("should return ValidatedConfig with all required properties", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
      };

      const config = validateEnv();

      expect(config).toHaveProperty("port");
      expect(config).toHaveProperty("sorobanEnabled");
      expect(config).toHaveProperty("contractId");
      expect(config).toHaveProperty("serverPrivateKey");
      expect(config).toHaveProperty("rpcUrl");
      expect(config).toHaveProperty("networkPassphrase");
      expect(config).toHaveProperty("allowedAssets");
      expect(config).toHaveProperty("dbPath");
      expect(config).toHaveProperty("webhookDestinationUrl");
      expect(config).toHaveProperty("webhookSigningSecret");
      expect(config).toHaveProperty("jwtSecret");
      expect(config).toHaveProperty("serverSigningKey");
      expect(config).toHaveProperty("domain");
      expect(config).toHaveProperty("indexerPollIntervalMs");
      expect(config).toHaveProperty("reconciliationIntervalMs");
      expect(config).toHaveProperty("adminApiKey");
    });

    it("should use default INDEXER_POLL_INTERVAL_MS of 10000ms", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
      };

      const config = validateEnv();

      expect(config.indexerPollIntervalMs).toBe(10000);
    });

    it("should accept valid INDEXER_POLL_INTERVAL_MS", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        INDEXER_POLL_INTERVAL_MS: "15000",
      };

      const config = validateEnv();

      expect(config.indexerPollIntervalMs).toBe(15000);
    });

    it("should enforce minimum INDEXER_POLL_INTERVAL_MS of 5000ms", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        INDEXER_POLL_INTERVAL_MS: "3000",
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
      // Implementation: logger.error({ envVar, issue: issue.message }, "environment variable validation issue")
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ envVar: "INDEXER_POLL_INTERVAL_MS" }),
        "environment variable validation issue",
      );
    });

    it("should reject invalid INDEXER_POLL_INTERVAL_MS", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        INDEXER_POLL_INTERVAL_MS: "not-a-number",
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ envVar: "INDEXER_POLL_INTERVAL_MS" }),
        "environment variable validation issue",
      );
    });

    it("should use default RECONCILIATION_INTERVAL_MS of 60000ms", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
      };

      const config = validateEnv();

      expect(config.reconciliationIntervalMs).toBe(60000);
    });

    it("should accept valid RECONCILIATION_INTERVAL_MS", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        RECONCILIATION_INTERVAL_MS: "120000",
      };

      const config = validateEnv();

      expect(config.reconciliationIntervalMs).toBe(120000);
    });

    it("should enforce minimum RECONCILIATION_INTERVAL_MS of 10000ms", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        RECONCILIATION_INTERVAL_MS: "5000",
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ envVar: "RECONCILIATION_INTERVAL_MS" }),
        "environment variable validation issue",
      );
    });
  });

  describe("Monitoring threshold validation", () => {
    it("should use safe defaults for webhook and indexer monitoring thresholds", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
      };

      const config = validateEnv();

      expect(config.webhookMonitorPendingWarnThreshold).toBe(100);
      expect(config.webhookMonitorRetryDueWarnThreshold).toBe(10);
      expect(config.webhookMonitorDeadLetterAlertThreshold).toBe(1);
      expect(config.indexerMonitorMaxLedgerLag).toBe(100);
      expect(config.indexerMonitorMaxConsecutiveErrors).toBe(5);
    });

    it("should accept explicit webhook and indexer monitoring thresholds", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        WEBHOOK_MONITOR_PENDING_WARN_THRESHOLD: "250",
        WEBHOOK_MONITOR_RETRY_DUE_WARN_THRESHOLD: "25",
        WEBHOOK_MONITOR_DEAD_LETTER_ALERT_THRESHOLD: "2",
        INDEXER_MONITOR_MAX_LEDGER_LAG: "500",
        INDEXER_MONITOR_MAX_CONSECUTIVE_ERRORS: "4",
      };

      const config = validateEnv();

      expect(config.webhookMonitorPendingWarnThreshold).toBe(250);
      expect(config.webhookMonitorRetryDueWarnThreshold).toBe(25);
      expect(config.webhookMonitorDeadLetterAlertThreshold).toBe(2);
      expect(config.indexerMonitorMaxLedgerLag).toBe(500);
      expect(config.indexerMonitorMaxConsecutiveErrors).toBe(4);
    });

    it("should reject invalid webhook monitoring thresholds before startup", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        WEBHOOK_MONITOR_PENDING_WARN_THRESHOLD: "0",
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ envVar: "WEBHOOK_MONITOR_PENDING_WARN_THRESHOLD" }),
        "environment variable validation issue",
      );
    });

    it("should reject invalid indexer monitoring thresholds before startup", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        INDEXER_MONITOR_MAX_CONSECUTIVE_ERRORS: "0",
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ envVar: "INDEXER_MONITOR_MAX_CONSECUTIVE_ERRORS" }),
        "environment variable validation issue",
      );
    });

    it("should redact sensitive webhook URL material in validation logs", () => {
      const rawUrl = "not-a-url?token=super-secret-token";
      process.env = {
        SOROBAN_DISABLED: "true",
        WEBHOOK_DESTINATION_URL: rawUrl,
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
      assertNoLoggerOutputContains("super-secret-token");
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ webhookDestinationUrl: "[REDACTED_INVALID_URL]" }),
        "WEBHOOK_DESTINATION_URL validation failed",
      );
    });

    it("redactUrlForConfigLog should preserve host while redacting sensitive query fields", () => {
      const redacted = redactUrlForConfigLog(
        "https://receiver.example/hook?token=abc123&tenant=public&signature=deadbeef",
      );

      expect(redacted).toContain("https://receiver.example/hook");
      expect(redacted).toContain("tenant=public");
      expect(redacted).not.toContain("abc123");
      expect(redacted).not.toContain("deadbeef");
    });
  });

  // ---------------------------------------------------------------------------
  // ADMIN_API_KEY validation
  // ---------------------------------------------------------------------------
  describe("ADMIN_API_KEY validation", () => {
    it("should accept ADMIN_API_KEY with 32+ characters", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        ADMIN_API_KEY: "a".repeat(32),
      };

      const config = validateEnv();

      expect(config.adminApiKey).toBe("a".repeat(32));
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("should accept ADMIN_API_KEY with more than 32 characters", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        ADMIN_API_KEY: "a".repeat(64),
      };

      const config = validateEnv();

      expect(config.adminApiKey).toBe("a".repeat(64));
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("should reject ADMIN_API_KEY with less than 32 characters in production", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        ADMIN_API_KEY: "short-key",
        NODE_ENV: "production",
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(loggerErrorSpy).toHaveBeenCalledWith("ADMIN_API_KEY validation failed");
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issue: expect.stringContaining("at least 32 characters") }),
        "ADMIN_API_KEY validation issue",
      );
    });

    it("should warn but allow short ADMIN_API_KEY in development", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        ADMIN_API_KEY: "short-key",
        NODE_ENV: "development",
      };

      const config = validateEnv();

      // Short key in dev is NOT stored (adminApiKey comes from adminKeyValidation.data which only
      // sets when validation succeeds).  The impl does not set adminApiKey for short keys.
      // The important assertions are: no exit, and the warning was logged.
      expect(exitSpy).not.toHaveBeenCalled();
      // Implementation: logger.warn("in development, short ADMIN_API_KEY values are allowed but not recommended")
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("short ADMIN_API_KEY values are allowed"),
      );
    });

    it("should return null adminApiKey when not provided", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
      };

      const config = validateEnv();

      expect(config.adminApiKey).toBeNull();
    });

    it("should warn when ADMIN_API_KEY not set in production", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        NODE_ENV: "production",
      };

      validateEnv();

      // Implementation: logger.warn("ADMIN_API_KEY is not set in production — admin endpoints will be inaccessible")
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("ADMIN_API_KEY is not set in production"),
      );
    });

    it("should not warn about ADMIN_API_KEY when not set in development", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        NODE_ENV: "development",
      };

      validateEnv();

      const warnCalls = loggerWarnSpy.mock.calls.filter((call: unknown[]) =>
        call[0]?.toString().includes("ADMIN_API_KEY is not set"),
      );
      expect(warnCalls).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // New contributor scenario: fresh checkout, no credentials, SOROBAN_DISABLED
  // ---------------------------------------------------------------------------
  describe("New contributor scenario: no Stellar credentials", () => {
    it("server can start with only SOROBAN_DISABLED=true (fresh .env clone)", () => {
      // Simulates: cp backend/.env.example backend/.env && set SOROBAN_DISABLED=true
      process.env = {
        SOROBAN_DISABLED: "true",
        // All other values left at defaults (ALLOWED_ASSETS, RPC_URL, etc.)
      };

      const config = validateEnv();

      // The server must start without credentials.
      expect(exitSpy).not.toHaveBeenCalled();
      expect(config.sorobanEnabled).toBe(false);
      expect(config.contractId).toBeNull();
      expect(config.serverPrivateKey).toBeNull();
      // Default port
      expect(config.port).toBe(3001);
      // Default assets
      expect(config.allowedAssets).toEqual(["USDC", "XLM"]);
    });

    it("should not exit when neither CONTRACT_ID nor SERVER_PRIVATE_KEY are set with SOROBAN_DISABLED=true", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        // Deliberately omit CONTRACT_ID, SERVER_PRIVATE_KEY
      };

      expect(() => validateEnv()).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("should exit when SOROBAN_DISABLED is absent and neither credential is set", () => {
      process.env = {
        // No SOROBAN_DISABLED, no CONTRACT_ID, no SERVER_PRIVATE_KEY
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("returns sorobanEnabled=false when SOROBAN_DISABLED is set to any truthy form", () => {
      process.env = {
        SOROBAN_DISABLED: "TRUE", // uppercase should also work
      };

      const config = validateEnv();

      expect(config.sorobanEnabled).toBe(false);
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Network selection: testnet vs mainnet (issue #1205)
  // ---------------------------------------------------------------------------
  describe("Network selection (STELLAR_NETWORK)", () => {
    it("defaults to testnet when STELLAR_NETWORK is unset", () => {
      process.env = { SOROBAN_DISABLED: "true" };

      const config = validateEnv();

      expect(config.stellarNetwork).toBe("testnet");
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("accepts the explicit testnet value (case/whitespace-insensitive)", () => {
      process.env = { SOROBAN_DISABLED: "true", STELLAR_NETWORK: "  Testnet " };

      const config = validateEnv();

      expect(config.stellarNetwork).toBe("testnet");
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("maps mainnet aliases (public, main) to the mainnet profile", () => {
      process.env = { SOROBAN_DISABLED: "true", STELLAR_NETWORK: "Public" };
      expect(validateEnv().stellarNetwork).toBe("mainnet");

      process.env = { SOROBAN_DISABLED: "true", STELLAR_NETWORK: "MAIN" };
      expect(validateEnv().stellarNetwork).toBe("mainnet");
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("exits when STELLAR_NETWORK is not a recognized network name", () => {
      process.env = { SOROBAN_DISABLED: "true", STELLAR_NETWORK: "stagenet" };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("must be \"testnet\" or \"mainnet\""),
      );
    });

    it("exits when mainnet is selected but RPC_URL points at testnet", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        STELLAR_NETWORK: "mainnet",
        RPC_URL: "https://soroban-testnet.stellar.org:443",
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ rpcUrl: expect.stringContaining("soroban-testnet") }),
        "network configuration mismatch",
      );
      expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining("RPC_URL points at a testnet endpoint"));
    });

    it("exits when testnet is selected but RPC_URL points at mainnet", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        STELLAR_NETWORK: "testnet",
        RPC_URL: "https://soroban-rpc.stellar.org:443",
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ rpcUrl: expect.stringContaining("soroban-rpc") }),
        "network configuration mismatch",
      );
      expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining("RPC_URL points at a mainnet endpoint"));
    });

    it("exits when NETWORK_PASSPHRASE contradicts STELLAR_NETWORK=mainnet", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        STELLAR_NETWORK: "mainnet",
        RPC_URL: "https://rpc.provider.example:443",
        NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(loggerErrorSpy).toHaveBeenCalledWith("network configuration mismatch");
      expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Align NETWORK_PASSPHRASE with STELLAR_NETWORK"));
    });

    it("does not reject custom passphrases (local standalone node)", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        STELLAR_NETWORK: "testnet",
        RPC_URL: "http://localhost:8000/soroban/rpc",
        NETWORK_PASSPHRASE: "Standalone Network ; February 2026",
      };

      const config = validateEnv();

      expect(config.stellarNetwork).toBe("testnet");
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("warns but starts when mainnet is selected with no RPC_URL (default points at testnet)", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        STELLAR_NETWORK: "mainnet",
      };

      const config = validateEnv();

      expect(config.stellarNetwork).toBe("mainnet");
      expect(exitSpy).not.toHaveBeenCalled();
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining("no RPC_URL set"));
    });

    it("still enforces credential checks when Soroban is enabled on mainnet", () => {
      process.env = {
        STELLAR_NETWORK: "mainnet",
        RPC_URL: "https://rpc.mainnet-provider.example:443",
        // no CONTRACT_ID / SERVER_PRIVATE_KEY
      };

      try {
        validateEnv();
      } catch (e) {}

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Soroban configuration incomplete"),
      );
    });
  });
});
