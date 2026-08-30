import { z } from "zod";

/**
 * Validates Soroban-related environment variables at startup.
 * Fails fast with helpful messages if config is invalid.
 * Distinguishes between required and optional config.
 * Allows local non-chain development to run intentionally.
 *
 * Uses console.* (not the structured logger) intentionally: this runs
 * before the rest of the app is wired up, and messages here are meant to
 * be read directly off the terminal by whoever is starting the server.
 */

const DEFAULT_TESTNET_CONTRACT_ID =
  "CCJW2RLIN4MQQ4DAJMMR3F5QPDA6QYTKXJMEVI3XOTDBTBCLBB553J74";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; October 2015";
const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org:443";

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

// Webhook dead-letter pruning job interval validation
const webhookDeadLetterPruneIntervalSchema = z
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
  RPC_URL: z.string().optional().default(DEFAULT_RPC_URL),
  SOROBAN_RPC_URL: z.string().optional(),
  NETWORK_PASSPHRASE: z.string().optional().default(TESTNET_PASSPHRASE),
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
  WEBHOOK_DEAD_LETTER_PRUNE_INTERVAL_MS: webhookDeadLetterPruneIntervalSchema
    .optional()
    .default(86400000),
  INDEXER_FALLBACK_POLLING_ENABLED: z.string().optional().default("false"),
  INDEXER_FALLBACK_POLL_INTERVAL_MS: fallbackPollIntervalSchema.optional().default(10000),
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
  webhookDeadLetterPruneIntervalMs: number;
  indexerFallbackPollingEnabled: boolean;
  indexerFallbackPollIntervalMs: number;
  adminApiKey: string | null;
  allowedOrigins: string | undefined;
}

export function validateEnv(): ValidatedConfig {
  // Support backwards compatibility: map old variables to new ones if new ones are not set
  if (!process.env.STELLAR_CONTRACT_ID && process.env.CONTRACT_ID) {
    process.env.STELLAR_CONTRACT_ID = process.env.CONTRACT_ID;
  }
  if (!process.env.SOROBAN_RPC_URL && process.env.RPC_URL) {
    process.env.SOROBAN_RPC_URL = process.env.RPC_URL;
  }

  // Parse environment variables
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error("❌ Environment validation failed:");
    parsed.error.issues.forEach((issue: z.ZodIssue) => {
      const envVar = issue.path.join(".");
      console.error(`   ${envVar}: ${issue.message}`);
    });
    process.exit(1);
    throw new Error("Environment validation failed"); // Ensure execution stops in tests
  }

  const env = parsed.data;
  const isProduction = process.env.NODE_ENV === "production";
  const isDevelopment = process.env.NODE_ENV === "development";
  const sorobanDisabled = process.env.SOROBAN_DISABLED?.toLowerCase() === "true";

  if (!sorobanDisabled) {
    // CONTRACT_ID and SERVER_PRIVATE_KEY are required unless the operator has
    // explicitly opted into local, non-chain development (NODE_ENV=development).
    if (!isDevelopment) {
      const missingContractId = !process.env.STELLAR_CONTRACT_ID;
      const missingPrivateKey = !process.env.SERVER_PRIVATE_KEY;

      if (missingContractId) {
        console.error(
          "❌ STELLAR_CONTRACT_ID is required in production. Either provide it, or set SOROBAN_DISABLED=true / NODE_ENV=development for local development.",
        );
      }
      if (missingPrivateKey) {
        console.error(
          "❌ SERVER_PRIVATE_KEY is required in production. Either provide it, or set SOROBAN_DISABLED=true / NODE_ENV=development for local development.",
        );
      }
      if (missingContractId || missingPrivateKey) {
        console.error("Required for on-chain operations:");
        console.error("  CONTRACT_ID: Soroban contract ID (starts with C, 56 characters)");
        console.error(
          "  SERVER_PRIVATE_KEY: Signing key for on-chain transactions (starts with S, 56 characters)",
        );
        console.error("Optional Soroban config: RPC_URL and NETWORK_PASSPHRASE");
        console.error("To run locally without on-chain operations, set SOROBAN_DISABLED=true");
        process.exit(1);
      }
    } else if (!process.env.STELLAR_CONTRACT_ID) {
      console.warn(
        "⚠️  STELLAR_CONTRACT_ID is missing in development, using default testnet contract ID",
      );
      process.env.STELLAR_CONTRACT_ID = DEFAULT_TESTNET_CONTRACT_ID;
    }

    // Validate CONTRACT_ID format, if present
    if (process.env.STELLAR_CONTRACT_ID) {
      const contractIdValidation = stellarAccountIdSchema.safeParse(
        process.env.STELLAR_CONTRACT_ID,
      );
      if (!contractIdValidation.success) {
        console.error("STELLAR_CONTRACT_ID validation failed");
        contractIdValidation.error.issues.forEach((issue: z.ZodIssue) => {
          console.error(`   ${issue.message}`);
        });
        process.exit(1);
      }
    }

    // Validate SERVER_PRIVATE_KEY format, if present
    if (process.env.SERVER_PRIVATE_KEY) {
      const keyValidation = stellarSecretKeySchema.safeParse(process.env.SERVER_PRIVATE_KEY);
      if (!keyValidation.success) {
        console.error("SERVER_PRIVATE_KEY validation failed");
        keyValidation.error.issues.forEach((issue: z.ZodIssue) => {
          console.error(`   ${issue.message}`);
        });
        process.exit(1);
      }
    }

    // Validate RPC_URL format
    const rpcValidation = urlSchema.safeParse(env.RPC_URL);
    if (!rpcValidation.success) {
      console.error(`RPC_URL validation failed: ${env.RPC_URL}`);
      process.exit(1);
    }

    // SOROBAN_RPC_URL: required in production, defaults with a warning otherwise
    if (isProduction) {
      if (!process.env.SOROBAN_RPC_URL) {
        console.error("❌ SOROBAN_RPC_URL is required in production.");
        process.exit(1);
      }
    } else if (!process.env.SOROBAN_RPC_URL) {
      console.warn(
        "⚠️  SOROBAN_RPC_URL is missing in development, using default testnet RPC URL",
      );
    }

    // STELLAR_NETWORK: required in production, defaults with a warning otherwise
    if (isProduction) {
      if (!process.env.STELLAR_NETWORK) {
        console.error("❌ STELLAR_NETWORK is required in production.");
        process.exit(1);
      }
    } else if (!process.env.STELLAR_NETWORK) {
      console.warn(
        "⚠️  STELLAR_NETWORK is missing in development, using default testnet network",
      );
    }

    console.log("Soroban configuration validated");
  } else {
    if (process.env.SERVER_PRIVATE_KEY) {
      console.warn(
        "⚠️  SOROBAN_DISABLED=true is set and SERVER_PRIVATE_KEY is configured. The private key will not be used or logged in disabled mode.",
      );
    }
    console.log("⚠️  Soroban disabled (SOROBAN_DISABLED=true) — local development mode");
  }

  // Validate optional webhook URL if provided
  if (env.WEBHOOK_DESTINATION_URL) {
    const webhookValidation = urlSchema.safeParse(env.WEBHOOK_DESTINATION_URL);
    if (!webhookValidation.success) {
      console.error(`WEBHOOK_DESTINATION_URL validation failed: ${env.WEBHOOK_DESTINATION_URL}`);
      process.exit(1);
    }
  }

  // Validate webhook signing secret if webhook URL is set
  if (env.WEBHOOK_DESTINATION_URL && !env.WEBHOOK_SIGNING_SECRET) {
    console.warn(
      "⚠️  WEBHOOK_DESTINATION_URL is set but WEBHOOK_SIGNING_SECRET is not — webhooks will not be signed",
    );
  }

  // Parse allowed assets
  const allowedAssets = (env.ALLOWED_ASSETS || "")
    .split(",")
    .map((asset: string) => asset.trim().toUpperCase())
    .filter((asset: string) => asset.length > 0);

  if (allowedAssets.length === 0) {
    console.error("ALLOWED_ASSETS must contain at least one asset code");
    process.exit(1);
  }

  // Validate ADMIN_API_KEY if provided
  let adminApiKey: string | null = null;

  if (process.env.ADMIN_API_KEY) {
    const adminKeyValidation = adminApiKeySchema.safeParse(process.env.ADMIN_API_KEY);
    if (!adminKeyValidation.success) {
      console.error("ADMIN_API_KEY validation failed");
      adminKeyValidation.error.issues.forEach((issue: z.ZodIssue) => {
        console.error(`   ${issue.message}`);
      });
      if (isProduction) {
        console.error("In production, ADMIN_API_KEY must be at least 32 characters");
        process.exit(1);
      } else {
        console.warn(
          "In development, short keys are allowed but not recommended for ADMIN_API_KEY",
        );
        adminApiKey = process.env.ADMIN_API_KEY;
      }
    } else {
      adminApiKey = process.env.ADMIN_API_KEY;
    }
  } else if (isProduction) {
    console.warn("ADMIN_API_KEY is not set in production — admin endpoints will be inaccessible");
  }

  // Network passphrase: explicit NETWORK_PASSPHRASE wins; otherwise derive from
  // STELLAR_NETWORK ("public" -> public passphrase, anything else -> testnet).
  let networkPassphrase = env.NETWORK_PASSPHRASE;
  if (!process.env.NETWORK_PASSPHRASE) {
    networkPassphrase =
      process.env.STELLAR_NETWORK === "public" ? PUBLIC_PASSPHRASE : TESTNET_PASSPHRASE;
  }

  console.log("configuration validated");

  return {
    port: env.PORT || 3001,
    sorobanEnabled: !sorobanDisabled,
    contractId: sorobanDisabled ? null : process.env.STELLAR_CONTRACT_ID || null,
    serverPrivateKey: sorobanDisabled ? null : process.env.SERVER_PRIVATE_KEY || null,
    rpcUrl: process.env.SOROBAN_RPC_URL || env.RPC_URL || DEFAULT_RPC_URL,
    networkPassphrase,
    allowedAssets,
    dbPath: env.DB_PATH || "backend/data/streams.db",
    webhookDestinationUrl: env.WEBHOOK_DESTINATION_URL || null,
    webhookSigningSecret: env.WEBHOOK_SIGNING_SECRET || null,
    jwtSecret: env.JWT_SECRET || "",
    serverSigningKey: env.SERVER_SIGNING_KEY || null,
    domain: env.DOMAIN,
    indexerPollIntervalMs: env.INDEXER_POLL_INTERVAL_MS,
    reconciliationIntervalMs: env.RECONCILIATION_INTERVAL_MS,
    archiveCronIntervalMs: env.ARCHIVE_CRON_INTERVAL_MS,
    webhookDeadLetterPruneIntervalMs: env.WEBHOOK_DEAD_LETTER_PRUNE_INTERVAL_MS,
    indexerFallbackPollingEnabled: process.env.INDEXER_FALLBACK_POLLING_ENABLED === "true",
    indexerFallbackPollIntervalMs: env.INDEXER_FALLBACK_POLL_INTERVAL_MS,
    adminApiKey,
    allowedOrigins: env.ALLOWED_ORIGINS,
  };
}
