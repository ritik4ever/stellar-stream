import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateEnv } from "./validateEnv";

describe("validateEnv", () => {
  const originalEnv = process.env;
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { });
  const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => { });

  beforeEach(() => {
    process.env = { ...originalEnv };
    exitSpy.mockClear();
    consoleErrorSpy.mockClear();
    consoleWarnSpy.mockClear();
    consoleLogSpy.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Acceptance Criteria 1: Invalid config fails fast with helpful messages", () => {
    it("should exit with code 1 when CONTRACT_ID is missing and Soroban enabled", () => {
      process.env = {
        SERVER_PRIVATE_KEY: "S" + "A".repeat(55),
      };

      try {
        validateEnv();
      } catch (e) { }

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("STELLAR_CONTRACT_ID is required in production")
      );
    });

    it("should exit with code 1 when SERVER_PRIVATE_KEY is missing and Soroban enabled", () => {
      process.env = {
        CONTRACT_ID: "C" + "A".repeat(55),
      };

      try {
        validateEnv();
      } catch (e) { }

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("SERVER_PRIVATE_KEY is required in production")
      );
    });

    it("should exit with code 1 when CONTRACT_ID format is invalid (not starting with C)", () => {
      process.env = {
        CONTRACT_ID: "G" + "A".repeat(55), // 56 chars, starts with G
        SERVER_PRIVATE_KEY: "S" + "A".repeat(55), // 56 chars, starts with S
      };

      try {
        validateEnv();
      } catch (e) { }

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("STELLAR_CONTRACT_ID validation failed")
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("must start with C (contract)")
      );
    });

    it("should exit with code 1 when SERVER_PRIVATE_KEY format is invalid (not starting with S)", () => {
      process.env = {
        CONTRACT_ID: "C" + "A".repeat(55),
        SERVER_PRIVATE_KEY: "G" + "A".repeat(55), // starts with G
      };

      try {
        validateEnv();
      } catch (e) { }

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("SERVER_PRIVATE_KEY validation failed")
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("must start with S")
      );
    });

    it("should exit with code 1 when RPC_URL is invalid and show the bad value", () => {
      const badUrl = "not-a-valid-url";
      process.env = {
        CONTRACT_ID: "C" + "A".repeat(55),
        SERVER_PRIVATE_KEY: "S" + "A".repeat(55),
        RPC_URL: badUrl,
      };

      try {
        validateEnv();
      } catch (e) { }

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`RPC_URL validation failed: ${badUrl}`)
      );
    });

    it("should provide helpful error message with suggestions", () => {
      process.env = {
        // missing CONTRACT_ID
        SERVER_PRIVATE_KEY: "S" + "A".repeat(55),
      };

      try {
        validateEnv();
      } catch (e) { }

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Required for on-chain operations:")
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("CONTRACT_ID: Soroban contract ID")
      );
    });
  });

  describe("Acceptance Criteria 2: Optional vs required config clearly distinguished", () => {
    it("should allow missing optional variables with defaults", () => {
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
      } catch (e) { }

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("should accept valid CONTRACT_ID and SERVER_PRIVATE_KEY", () => {
      process.env = {
        CONTRACT_ID: "C" + "A".repeat(55),
        SERVER_PRIVATE_KEY: "S" + "A".repeat(55),
        JWT_SECRET: "test-secret", // Add required fields that might be causing failure
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

  function assertNoConsoleOutputContains(hiddenValue: string) {
    const allCalls = [
      ...consoleLogSpy.mock.calls,
      ...consoleWarnSpy.mock.calls,
      ...consoleErrorSpy.mock.calls,
    ];

    for (const args of allCalls) {
      const output = args.join(" ");
      expect(output).not.toContain(hiddenValue);
    }
  }

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
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Soroban disabled")
      );
    });

    it("should show warning when Soroban disabled", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
      };

      validateEnv();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("⚠️  Soroban disabled")
      );
    });

    it("should warn and not expose the private key when SOROBAN_DISABLED=true and SERVER_PRIVATE_KEY is configured", () => {
      const privateKey =
        "SBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3";
      process.env = {
        SOROBAN_DISABLED: "true",
        SERVER_PRIVATE_KEY: privateKey,
      };

      const config = validateEnv();

      expect(config.sorobanEnabled).toBe(false);
      expect(config.serverPrivateKey).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "SOROBAN_DISABLED=true is set and SERVER_PRIVATE_KEY is configured"
        )
      );
      assertNoConsoleOutputContains(privateKey);
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
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("PORT: must be a valid port number")
      );
    });
  });

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

  describe("Additional validation scenarios", () => {
    it("should warn when WEBHOOK_DESTINATION_URL set without WEBHOOK_SIGNING_SECRET", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        WEBHOOK_DESTINATION_URL: "https://example.com/webhook",
      };

      validateEnv();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("WEBHOOK_SIGNING_SECRET is not")
      );
    });

    it("should validate WEBHOOK_DESTINATION_URL format and show the bad value", () => {
      const badUrl = "not-a-url";
      process.env = {
        SOROBAN_DISABLED: "true",
        WEBHOOK_DESTINATION_URL: badUrl,
      };

      try {
        validateEnv();
      } catch (e) { }

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`WEBHOOK_DESTINATION_URL validation failed: ${badUrl}`)
      );
    });

    it("should exit with code 1 when ALLOWED_ASSETS is empty", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        ALLOWED_ASSETS: "",
      };

      try {
        validateEnv();
      } catch (e) { }

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("ALLOWED_ASSETS must contain at least one asset code")
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
      } catch (e) { }

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("INDEXER_POLL_INTERVAL_MS: must be a valid number >= 5000")
      );
    });

    it("should reject invalid INDEXER_POLL_INTERVAL_MS", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        INDEXER_POLL_INTERVAL_MS: "not-a-number",
      };

      try {
        validateEnv();
      } catch (e) { }

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("INDEXER_POLL_INTERVAL_MS: must be a valid number >= 5000")
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
      } catch (e) { }

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("RECONCILIATION_INTERVAL_MS: must be a valid number >= 10000")
      );
    });
  });

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
    } catch (e) { }

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("ADMIN_API_KEY validation failed")
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("must be at least 32 characters")
    );
  });

  it("should warn but allow short ADMIN_API_KEY in development", () => {
    process.env = {
      SOROBAN_DISABLED: "true",
      ADMIN_API_KEY: "short-key",
      NODE_ENV: "development",
    };

    const config = validateEnv();

    expect(config.adminApiKey).toBe("short-key");
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("In development, short keys are allowed")
    );
    expect(exitSpy).not.toHaveBeenCalled();
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

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("ADMIN_API_KEY is not set in production")
    );
  });

  it("should not warn when ADMIN_API_KEY not set in development", () => {
    process.env = {
      SOROBAN_DISABLED: "true",
      NODE_ENV: "development",
    };

    validateEnv();

    const warnCalls = consoleWarnSpy.mock.calls.filter((call) =>
      call[0]?.toString().includes("ADMIN_API_KEY is not set")
    );
    expect(warnCalls).toHaveLength(0);
  });

  describe("Acceptance Criteria: Startup validation for SOROBAN_RPC_URL, STELLAR_CONTRACT_ID, and STELLAR_NETWORK", () => {
    describe("in production mode", () => {
      beforeEach(() => {
        process.env.NODE_ENV = "production";
      });

      it("should exit with code 1 when SOROBAN_RPC_URL is missing", () => {
        process.env.STELLAR_CONTRACT_ID = "CBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3";
        process.env.STELLAR_NETWORK = "testnet";
        process.env.SERVER_PRIVATE_KEY = "SBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3";
        
        validateEnv();
        
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("SOROBAN_RPC_URL is required in production")
        );
      });

      it("should exit with code 1 when STELLAR_CONTRACT_ID is missing", () => {
        process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org:443";
        process.env.STELLAR_NETWORK = "testnet";
        process.env.SERVER_PRIVATE_KEY = "SBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3";

        validateEnv();

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("STELLAR_CONTRACT_ID is required in production")
        );
      });

      it("should exit with code 1 when STELLAR_NETWORK is missing", () => {
        process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org:443";
        process.env.STELLAR_CONTRACT_ID = "CBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3";
        process.env.SERVER_PRIVATE_KEY = "SBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3";

        validateEnv();

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("STELLAR_NETWORK is required in production")
        );
      });

      it("should exit with code 1 when SERVER_PRIVATE_KEY is missing", () => {
        process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org:443";
        process.env.STELLAR_CONTRACT_ID = "CBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3";
        process.env.STELLAR_NETWORK = "testnet";

        validateEnv();

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("SERVER_PRIVATE_KEY is required in production")
        );
      });
    });

    describe("in development mode", () => {
      beforeEach(() => {
        process.env.NODE_ENV = "development";
      });

      it("should log warning and use testnet default when SOROBAN_RPC_URL is missing", () => {
        process.env.STELLAR_CONTRACT_ID = "CBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3";
        process.env.STELLAR_NETWORK = "testnet";
        process.env.SERVER_PRIVATE_KEY = "SBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3";

        const config = validateEnv();

        expect(exitSpy).not.toHaveBeenCalled();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("SOROBAN_RPC_URL is missing in development")
        );
        expect(config.rpcUrl).toBe("https://soroban-testnet.stellar.org:443");
      });

      it("should log warning and use testnet default when STELLAR_CONTRACT_ID is missing", () => {
        process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org:443";
        process.env.STELLAR_NETWORK = "testnet";
        process.env.SERVER_PRIVATE_KEY = "SBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3";

        const config = validateEnv();

        expect(exitSpy).not.toHaveBeenCalled();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("STELLAR_CONTRACT_ID is missing in development")
        );
        expect(config.contractId).toBe("CCJW2RLIN4MQQ4DAJMMR3F5QPDA6QYTKXJMEVI3XOTDBTBCLBB553J74");
      });

      it("should log warning and use testnet default when STELLAR_NETWORK is missing", () => {
        process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org:443";
        process.env.STELLAR_CONTRACT_ID = "CBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3";
        process.env.SERVER_PRIVATE_KEY = "SBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3";

        const config = validateEnv();

        expect(exitSpy).not.toHaveBeenCalled();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("STELLAR_NETWORK is missing in development")
        );
        expect(config.networkPassphrase).toBe("Test SDF Network ; September 2015");
      });

      it("should map STELLAR_NETWORK public to public passphrase", () => {
        process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org:443";
        process.env.STELLAR_CONTRACT_ID = "CBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3";
        process.env.STELLAR_NETWORK = "public";
        process.env.SERVER_PRIVATE_KEY = "SBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3";

        const config = validateEnv();

        expect(config.networkPassphrase).toBe("Public Global Stellar Network ; October 2015");
      });
    });
  });
});
});
