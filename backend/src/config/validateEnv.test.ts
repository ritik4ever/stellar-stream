import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateEnv } from "./validateEnv";

describe("validateEnv", () => {
  const originalEnv = process.env;
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

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
        SERVER_PRIVATE_KEY: "SBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3",
      };

      validateEnv();

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Soroban configuration incomplete")
      );
    });

    it("should exit with code 1 when SERVER_PRIVATE_KEY is missing and Soroban enabled", () => {
      process.env = {
        CONTRACT_ID: "CBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3",
      };

      validateEnv();

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Soroban configuration incomplete")
      );
    });

    it("should exit with code 1 when CONTRACT_ID format is invalid", () => {
      process.env = {
        CONTRACT_ID: "INVALID_CONTRACT_ID",
        SERVER_PRIVATE_KEY: "SBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3",
      };

      validateEnv();

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("CONTRACT_ID validation failed")
      );
    });

    it("should exit with code 1 when SERVER_PRIVATE_KEY format is invalid", () => {
      process.env = {
        CONTRACT_ID: "CBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3",
        SERVER_PRIVATE_KEY: "INVALID_KEY",
      };

      validateEnv();

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("SERVER_PRIVATE_KEY validation failed")
      );
    });

    it("should exit with code 1 when RPC_URL is invalid", () => {
      process.env = {
        CONTRACT_ID: "CBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3",
        SERVER_PRIVATE_KEY: "SBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3",
        RPC_URL: "not-a-valid-url",
      };

      validateEnv();

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("RPC_URL validation failed")
      );
    });

    it("should provide helpful error message with suggestions", () => {
      process.env = {
        SERVER_PRIVATE_KEY: "SBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3",
      };

      validateEnv();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Required for on-chain operations")
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("SOROBAN_DISABLED=true")
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
        SOROBAN_DISABLED: "false",
      };

      validateEnv();

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("should accept valid CONTRACT_ID and SERVER_PRIVATE_KEY", () => {
      process.env = {
        CONTRACT_ID: "CBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3",
        SERVER_PRIVATE_KEY: "SBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3",
      };

      const config = validateEnv();

      expect(config.sorobanEnabled).toBe(true);
      expect(config.contractId).toBe(
        "CBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3"
      );
      expect(config.serverPrivateKey).toBe(
        "SBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3"
      );
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
        PORT: "invalid_port",
      };

      validateEnv();

      expect(exitSpy).toHaveBeenCalledWith(1);
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
        CONTRACT_ID: "CBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3",
        SERVER_PRIVATE_KEY: "SBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3",
      };

      const config = validateEnv();

      expect(config.rpcUrl).toBe("https://soroban-testnet.stellar.org:443");
    });

    it("should validate NETWORK_PASSPHRASE default from README", () => {
      process.env = {
        CONTRACT_ID: "CBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3",
        SERVER_PRIVATE_KEY: "SBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3",
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

    it("should validate WEBHOOK_DESTINATION_URL format", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        WEBHOOK_DESTINATION_URL: "not-a-url",
      };

      validateEnv();

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("WEBHOOK_DESTINATION_URL validation failed")
      );
    });

    it("should reject empty ALLOWED_ASSETS", () => {
      process.env = {
        SOROBAN_DISABLED: "true",
        ALLOWED_ASSETS: "",
      };

      validateEnv();

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
        CONTRACT_ID: "CBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3",
        SERVER_PRIVATE_KEY: "SBZVMB74Z76QZ3ZZZ3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3",
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
    });
  });
});
