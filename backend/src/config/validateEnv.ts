import { z } from "zod";

/**
 * Validates Soroban-related environment variables at startup.
 * Fails fast with helpful messages if config is invalid.
 * Distinguishes between required and optional config.
 * Allows local non-chain development to run intentionally.
 */

// Stellar account ID format: 56 chars, starts with G (public) or C (contract)
const stellarAccountIdSchema = z
  .string()
  .length(56, "must be exactly 56 characters")
  .regex(/^C/, "must start with C (contract)");

// Stellar secret key format: 56 chars, starts with S
const stellarSecretKeySchema = z
  .string()
  .length(56, "must be exactly 56 characters")
  .regex(/^S/, "must start with S");

// URL validation
const urlSchema = z.string().url("must be a valid URL");

// Port validation
const portSchema = z
  .string()
  .transform((val: string) => parseInt(val, 10))
  .refine((val: number) => !isNaN(val) && val > 0 && val < 65536, {
    message: "must be a valid port number (1-65535)",
  });

// Indexer poll interval validation
const indexerPollIntervalSchema = z
  .string()
  .transform((val: string) => parseInt(val, 10))
  .refine((val: number) => !isNaN(val) && val >= 5000, {
    message: "must be a valid number >= 5000 (minimum 5 seconds)",
  });

// Reconciliation job interval validation
const reconciliationIntervalSchema = z
  .string()
  .transform((val: string) => parseInt(val, 10))
  .refine((val: number) => !isNaN(val) && val >= 10000, {
    message: "must be a valid number >= 10000 (minimum 10 seconds)",
  });

// Archive job interval validation
const archiveCronIntervalSchema = z
  .string()
  .transform((val: string) => parseInt(val, 10))
  .refine((val: number) => !isNaN(val) && val >= 60000, {
    message: "must be a valid number >= 60000 (minimum 1 minute)",
  });

// Indexer fallback polling interval validation
const fallbackPollIntervalSchema = z
  .string()
  .transform((val: string) => parseInt(val, 10))
  .refine((val: number) => !isNaN(val) && val >= 1000, {
    message: "must be a valid number >= 1000 (minimum 1 second)",
  });

// Admin API key validation
const adminApiKeySchema = z
  .string()
  .min(32, "must be at least 32 characters for security");

// Environment config schema
const envSchema = z.object({
  PORT: portSchema.optional().default(3001),
  CONTRACT_ID: z.string().optional(),
  STELLAR_CONTRACT_ID: z.string().optional(),
  SERVER_PRIVATE_KEY: z.string().optional(),
  RPC_URL: z.string().optional(),
  SOROBAN_RPC_URL: z.string().optional(),
  NETWORK_PASSPHRASE: z.string().optional(),
  STELLAR_NETWORK: z.string().optional(),
  ALLOWED_ASSETS: z.string().optional().default("USDC,XLM"),
  DB_PATH: z.string().optional().default("backend/data/streams.db"),
  WEBHOOK_DESTINATION_URL: z.string().optional(),
  WEBHOOK_SIGNING_SECRET: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  SERVER_SIGNING_KEY: z.string().optional(),
  DOMAIN: z.string().optional().default("localhost"),
  SOROBAN_DISABLED: z.string().optional(),
  INDEXER_POLL_INTERVAL_MS: indexerPollIntervalSchema.optional().default(10000),
  RECONCILIATION_INTERVAL_MS: reconciliationIntervalSchema.optional().default(60000),
  ARCHIVE_CRON_INTERVAL_MS: archiveCronIntervalSchema.optional().default(86400000),
  INDEXER_FALLBACK_POLLING_ENABLED: z.string().optional().default("false"),
  INDEXER_FALLBACK_POLL_INTERVAL_MS: fallbackPollIntervalSchema.optional().default(10000),
  WEBHOOK_DEAD_LETTER_PRUNE_INTERVAL_MS: archiveCronIntervalSchema.optional().default(86400000),
  ALLOWED_ORIGINS: z.string().optional(),
});

export interface ValidatedConfig {
  port: number;
  sorobanEnabled: boolean;
  contractId: string | null;
  serverPrivateKey: string | null;
  rpcUrl: string;
  networkPassphrase: string;
  allowedAssets: string[];
  dbPath: string;
  webhookDestinationUrl: string | null;
  webhookSigningSecret: string | null;
  jwtSecret: string | undefined;
  serverSigningKey: string | null;
  domain: string;
  indexerPollIntervalMs: number;
  reconciliationIntervalMs: number;
  archiveCronIntervalMs: number;
  indexerFallbackPollingEnabled: boolean;
  indexerFallbackPollIntervalMs: number;
  webhookDeadLetterPruneIntervalMs: number;
  adminApiKey: string | null;
  allowedOrigins: string | undefined;
}

// Testnet defaults used in development mode and when env vars are unset
const TESTNET_RPC_URL = "https://soroban-testnet.stellar.org:443";
const TESTNET_CONTRACT_ID = "CCJW2RLIN4MQQ4DAJMMR3F5QPDA6QYTKXJMEVI3XOTDBTBCLBB553J74";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; October 2015";

function fallbackConfig(overrides: Partial<ValidatedConfig> = {}): ValidatedConfig {
  return {
    port: 3001,
    sorobanEnabled: true,
    contractId: null,
    serverPrivateKey: null,
    rpcUrl: TESTNET_RPC_URL,
    networkPassphrase: TESTNET_PASSPHRASE,
    allowedAssets: ["USDC", "XLM"],
    dbPath: "backend/data/streams.db",
    webhookDestinationUrl: null,
    webhookSigningSecret: null,
    jwtSecret: "",
    serverSigningKey: null,
    domain: "localhost",
    indexerPollIntervalMs: 10000,
    reconciliationIntervalMs: 60000,
    archiveCronIntervalMs: 86400000,
    indexerFallbackPollingEnabled: false,
    indexerFallbackPollIntervalMs: 10000,
    webhookDeadLetterPruneIntervalMs: 86400000,
    adminApiKey: null,
    allowedOrigins: undefined,
    ...overrides,
  };
}

export function validateEnv(): ValidatedConfig {
  // Support backwards compatibility: map old variables to new ones if new ones are not set
  if (!process.env.STELLAR_CONTRACT_ID && process.env.CONTRACT_ID) {
    process.env.STELLAR_CONTRACT_ID = process.env.CONTRACT_ID;
  }
  if (!process.env.SOROBAN_RPC_URL && process.env.RPC_URL) {
    process.env.SOROBAN_RPC_URL = process.env.RPC_URL;
  }

  const isProduction = process.env.NODE_ENV === "production";
  const isDevelopment = process.env.NODE_ENV === "development";
  const sorobanDisabled = process.env.SOROBAN_DISABLED?.toLowerCase() === "true";

  // Parse environment variables
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error("❌ Environment configuration invalid:");
    for (const issue of parsed.error.issues) {
      console.error(`   ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    process.exit(1);
    return fallbackConfig();
  }

  const env = parsed.data;

  if (!sorobanDisabled) {
    if (isProduction) {
      // In production every on-chain setting is required
      const required: Array<[string, string | undefined]> = [
        ["SOROBAN_RPC_URL", process.env.SOROBAN_RPC_URL],
        ["STELLAR_CONTRACT_ID", process.env.STELLAR_CONTRACT_ID],
        ["STELLAR_NETWORK", process.env.STELLAR_NETWORK],
        ["SERVER_PRIVATE_KEY", process.env.SERVER_PRIVATE_KEY],
      ];
      for (const [name, value] of required) {
        if (!value) {
          console.error(`❌ ${name} is required in production`);
          process.exit(1);
          return fallbackConfig();
        }
      }
    } else if (isDevelopment) {
      // Development mode falls back to testnet defaults with helpful warnings
      if (!process.env.SOROBAN_RPC_URL) {
        console.warn("⚠️  SOROBAN_RPC_URL is missing in development — using testnet default");
      }
      if (!process.env.STELLAR_CONTRACT_ID) {
        console.warn("⚠️  STELLAR_CONTRACT_ID is missing in development — using testnet default");
      }
      if (!process.env.STELLAR_NETWORK) {
        console.warn("⚠️  STELLAR_NETWORK is missing in development — using testnet default");
      }
      if (!process.env.SERVER_PRIVATE_KEY) {
        console.error("❌ SERVER_PRIVATE_KEY is required in production");
        process.exit(1);
        return fallbackConfig();
      }
    } else {
      // CONTRACT_ID and SERVER_PRIVATE_KEY are required for Soroban operations
      if (!process.env.STELLAR_CONTRACT_ID) {
        console.error("❌ STELLAR_CONTRACT_ID is required in production");
        console.error("");
        console.error("Required for on-chain operations:");
        console.error("- CONTRACT_ID: Soroban contract ID");
        console.error("- SERVER_PRIVATE_KEY: Stellar secret key for signing transactions");
        console.error("");
        console.error("To run locally without on-chain operations, set SOROBAN_DISABLED=true");
        process.exit(1);
        return fallbackConfig();
      }
      if (!process.env.SERVER_PRIVATE_KEY) {
        console.error("❌ SERVER_PRIVATE_KEY is required in production");
        console.error("");
        console.error("Required for on-chain operations:");
        console.error("- CONTRACT_ID: Soroban contract ID");
        console.error("- SERVER_PRIVATE_KEY: Stellar secret key for signing transactions");
        console.error("");
        console.error("To run locally without on-chain operations, set SOROBAN_DISABLED=true");
        process.exit(1);
        return fallbackConfig();
      }
    }

    // Validate STELLAR_CONTRACT_ID format
    if (process.env.STELLAR_CONTRACT_ID) {
      const contractIdValidation = stellarAccountIdSchema.safeParse(process.env.STELLAR_CONTRACT_ID);
      if (!contractIdValidation.success) {
        console.error("❌ STELLAR_CONTRACT_ID validation failed:");
        for (const issue of contractIdValidation.error.issues) {
          console.error(`   ${issue.message}`);
        }
        process.exit(1);
        return fallbackConfig();
      }
    }

    // Validate SERVER_PRIVATE_KEY format
    if (process.env.SERVER_PRIVATE_KEY) {
      const keyValidation = stellarSecretKeySchema.safeParse(process.env.SERVER_PRIVATE_KEY);
      if (!keyValidation.success) {
        console.error("❌ SERVER_PRIVATE_KEY validation failed:");
        for (const issue of keyValidation.error.issues) {
          console.error(`   ${issue.message}`);
        }
        process.exit(1);
        return fallbackConfig();
      }
    }

    // Validate RPC_URL format
    const rpcUrlValue = process.env.SOROBAN_RPC_URL || TESTNET_RPC_URL;
    const rpcValidation = urlSchema.safeParse(rpcUrlValue);
    if (!rpcValidation.success) {
      console.error(`❌ RPC_URL validation failed: ${rpcUrlValue}`);
      for (const issue of rpcValidation.error.issues) {
        console.error(`   ${issue.message}`);
      }
      process.exit(1);
      return fallbackConfig();
    }

    console.log("Soroban configuration validated");
  } else {
    if (process.env.SERVER_PRIVATE_KEY) {
      console.warn(
        "⚠️  SOROBAN_DISABLED=true is set and SERVER_PRIVATE_KEY is configured. The private key will not be used or logged in disabled mode."
      );
    }
    console.log("⚠️  Soroban disabled (SOROBAN_DISABLED=true) — local development mode");
  }

  // Validate optional webhook URL if provided
  if (env.WEBHOOK_DESTINATION_URL) {
    const webhookValidation = urlSchema.safeParse(env.WEBHOOK_DESTINATION_URL);
    if (!webhookValidation.success) {
      console.error(`❌ WEBHOOK_DESTINATION_URL validation failed: ${env.WEBHOOK_DESTINATION_URL}`);
      for (const issue of webhookValidation.error.issues) {
        console.error(`   ${issue.message}`);
      }
      process.exit(1);
      return fallbackConfig();
    }
  }

  // Validate webhook signing secret if webhook URL is set
  if (env.WEBHOOK_DESTINATION_URL && !env.WEBHOOK_SIGNING_SECRET) {
    console.warn(
      "⚠️  WEBHOOK_DESTINATION_URL is set but WEBHOOK_SIGNING_SECRET is not — webhooks will not be signed"
    );
  }

  // Parse allowed assets
  const allowedAssets = (env.ALLOWED_ASSETS || "")
    .split(",")
    .map((asset: string) => asset.trim().toUpperCase())
    .filter((asset: string) => asset.length > 0);

  if (allowedAssets.length === 0) {
    console.error("❌ ALLOWED_ASSETS must contain at least one asset code");
    process.exit(1);
    return fallbackConfig();
  }

  // Validate ADMIN_API_KEY if provided
  let adminApiKey: string | null = null;

  if (process.env.ADMIN_API_KEY) {
    const adminKeyValidation = adminApiKeySchema.safeParse(process.env.ADMIN_API_KEY);
    if (!adminKeyValidation.success) {
      if (isProduction) {
        console.error("❌ ADMIN_API_KEY validation failed:");
        for (const issue of adminKeyValidation.error.issues) {
          console.error(`   ${issue.message}`);
        }
        process.exit(1);
        return fallbackConfig();
      } else {
        console.warn("⚠️  In development, short keys are allowed but not recommended");
        adminApiKey = process.env.ADMIN_API_KEY;
      }
    } else {
      adminApiKey = process.env.ADMIN_API_KEY;
    }
  } else if (isProduction) {
    console.warn("⚠️  ADMIN_API_KEY is not set in production — admin endpoints will be inaccessible");
  }

  const stellarNetwork = process.env.STELLAR_NETWORK;
  const networkPassphrase =
    process.env.NETWORK_PASSPHRASE ||
    (stellarNetwork === "public" ? PUBLIC_PASSPHRASE : TESTNET_PASSPHRASE);

  const config = {
    port: env.PORT,
    sorobanEnabled: !sorobanDisabled,
    contractId: sorobanDisabled
      ? null
      : process.env.STELLAR_CONTRACT_ID || (isDevelopment ? TESTNET_CONTRACT_ID : null),
    serverPrivateKey: sorobanDisabled ? null : process.env.SERVER_PRIVATE_KEY || null,
    rpcUrl: process.env.SOROBAN_RPC_URL || TESTNET_RPC_URL,
    networkPassphrase,
    allowedAssets,
    dbPath: env.DB_PATH,
    webhookDestinationUrl: env.WEBHOOK_DESTINATION_URL || null,
    webhookSigningSecret: env.WEBHOOK_SIGNING_SECRET || null,
    jwtSecret: env.JWT_SECRET || "",
    serverSigningKey: env.SERVER_SIGNING_KEY || null,
    domain: env.DOMAIN,
    indexerPollIntervalMs: env.INDEXER_POLL_INTERVAL_MS,
    reconciliationIntervalMs: env.RECONCILIATION_INTERVAL_MS,
    archiveCronIntervalMs: env.ARCHIVE_CRON_INTERVAL_MS,
    indexerFallbackPollingEnabled: process.env.INDEXER_FALLBACK_POLLING_ENABLED === "true",
    indexerFallbackPollIntervalMs: env.INDEXER_FALLBACK_POLL_INTERVAL_MS,
    webhookDeadLetterPruneIntervalMs: env.WEBHOOK_DEAD_LETTER_PRUNE_INTERVAL_MS,
    adminApiKey,
    allowedOrigins: env.ALLOWED_ORIGINS,
  };

  console.log(
    `configuration validated: port=${config.port} allowedAssets=${allowedAssets.join(",")} ` +
      `indexerPollIntervalMs=${config.indexerPollIntervalMs} ` +
      `reconciliationIntervalMs=${config.reconciliationIntervalMs} ` +
      `archiveCronIntervalMs=${config.archiveCronIntervalMs}`
  );

  return config;
}
