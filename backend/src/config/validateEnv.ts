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

// Reconciliation interval validation
const reconciliationIntervalSchema = z
  .string()
  .transform((val: string) => parseInt(val, 10))
  .refine((val: number) => !isNaN(val) && val >= 10000, {
    message: "must be a valid number >= 10000 (minimum 10 seconds)",
  });

// Admin API key validation
const adminApiKeySchema = z
  .string()
  .min(32, "must be at least 32 characters for security");

// Environment config schema
const envSchema = z.object({
  PORT: portSchema.optional().default(3001),
  CONTRACT_ID: z.string().optional(),
  SERVER_PRIVATE_KEY: z.string().optional(),
  RPC_URL: z.string().optional().default("https://soroban-testnet.stellar.org:443"),
  NETWORK_PASSPHRASE: z
    .string()
    .optional()
    .default("Test SDF Network ; September 2015"),
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
  adminApiKey: string | null;
}

export function validateEnv(): ValidatedConfig {
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

  // Determine if Soroban is disabled
  const sorobanDisabled = env.SOROBAN_DISABLED?.toLowerCase() === "true";

  // Validate Soroban-related config
  let contractId: string | null = null;
  let serverPrivateKey: string | null = null;

  if (!sorobanDisabled) {
    // CONTRACT_ID and SERVER_PRIVATE_KEY are required for Soroban operations
    if (!env.CONTRACT_ID || !env.SERVER_PRIVATE_KEY) {
      console.error(
        "❌ Soroban configuration incomplete. Either provide both CONTRACT_ID and SERVER_PRIVATE_KEY, or set SOROBAN_DISABLED=true for local development.\n"
      );
      console.error("   Required for on-chain operations:");
      console.error("   - CONTRACT_ID: Soroban contract ID (56 chars, starts with C)");
      console.error("   - SERVER_PRIVATE_KEY: Stellar secret key (56 chars, starts with S)\n");
      console.error("   Optional:");
      console.error("   - RPC_URL: Soroban RPC endpoint");
      console.error("   - NETWORK_PASSPHRASE: Stellar network passphrase\n");
      console.error("   To run locally without on-chain operations:");
      console.error("   - Set SOROBAN_DISABLED=true\n");
      process.exit(1);
      throw new Error("Environment validation failed");
    }

    // Validate CONTRACT_ID format
    const contractIdValidation = stellarAccountIdSchema.safeParse(env.CONTRACT_ID);
    if (!contractIdValidation.success) {
      console.error("❌ CONTRACT_ID validation failed:");
      contractIdValidation.error.issues.forEach((issue: z.ZodIssue) => {
        console.error(`   ${issue.message}`);
      });
      process.exit(1);
      throw new Error("Environment validation failed");
    }

    // Validate SERVER_PRIVATE_KEY format
    const keyValidation = stellarSecretKeySchema.safeParse(env.SERVER_PRIVATE_KEY);
    if (!keyValidation.success) {
      console.error("❌ SERVER_PRIVATE_KEY validation failed:");
      keyValidation.error.issues.forEach((issue: z.ZodIssue) => {
        console.error(`   ${issue.message}`);
      });
      process.exit(1);
      throw new Error("Environment validation failed");
    }

    // Validate RPC_URL format
    const rpcValidation = urlSchema.safeParse(env.RPC_URL);
    if (!rpcValidation.success) {
      console.error(`❌ RPC_URL validation failed: ${env.RPC_URL}`);
      rpcValidation.error.issues.forEach((issue: z.ZodIssue) => {
        console.error(`   ${issue.message}`);
      });
      process.exit(1);
      throw new Error("Environment validation failed");
    }

    contractId = env.CONTRACT_ID;
    serverPrivateKey = env.SERVER_PRIVATE_KEY;

    console.log("✅ Soroban configuration validated");
  } else {
    if (env.SERVER_PRIVATE_KEY) {
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
      webhookValidation.error.issues.forEach((issue: z.ZodIssue) => {
        console.error(`   ${issue.message}`);
      });
      process.exit(1);
      throw new Error("Environment validation failed");
    }
  }

  // Validate webhook signing secret if webhook URL is set
  if (env.WEBHOOK_DESTINATION_URL && !env.WEBHOOK_SIGNING_SECRET) {
    console.warn(
      "⚠️  WEBHOOK_DESTINATION_URL is set but WEBHOOK_SIGNING_SECRET is not — webhooks will not be signed"
    );
  }

  // Parse allowed assets
  const allowedAssets = env.ALLOWED_ASSETS.split(",")
    .map((asset: string) => asset.trim().toUpperCase())
    .filter((asset: string) => asset.length > 0);

  if (allowedAssets.length === 0) {
    console.error("❌ ALLOWED_ASSETS must contain at least one asset code");
    process.exit(1);
    throw new Error("Environment validation failed");
  }

  // Validate ADMIN_API_KEY if provided
  let adminApiKey: string | null = null;
  const isProduction = process.env.NODE_ENV === "production";

  if (process.env.ADMIN_API_KEY) {
    const adminKeyValidation = adminApiKeySchema.safeParse(process.env.ADMIN_API_KEY);
    if (!adminKeyValidation.success) {
      console.error("❌ ADMIN_API_KEY validation failed:");
      adminKeyValidation.error.issues.forEach((issue: z.ZodIssue) => {
        console.error(`   ${issue.message}`);
      });
      if (isProduction) {
        console.error("   In production, ADMIN_API_KEY must be at least 32 characters");
        process.exit(1);
        throw new Error("Environment validation failed");
      } else {
        console.warn("   ⚠️  In development, short keys are allowed but not recommended");
      }
    } else {
      adminApiKey = process.env.ADMIN_API_KEY;
    }
  } else if (isProduction) {
    console.warn("⚠️  ADMIN_API_KEY is not set in production — admin endpoints will be inaccessible");
  }

  console.log(`✅ Configuration validated (port: ${env.PORT}, assets: ${allowedAssets.join(", ")}, indexer interval: ${env.INDEXER_POLL_INTERVAL_MS}ms)`);

  return {
    port: env.PORT,
    sorobanEnabled: !sorobanDisabled,
    contractId,
    serverPrivateKey,
    rpcUrl: env.RPC_URL,
    networkPassphrase: env.NETWORK_PASSPHRASE,
    allowedAssets,
    dbPath: env.DB_PATH,
    webhookDestinationUrl: env.WEBHOOK_DESTINATION_URL || null,
    webhookSigningSecret: env.WEBHOOK_SIGNING_SECRET || null,
    jwtSecret: env.JWT_SECRET,
    serverSigningKey: env.SERVER_SIGNING_KEY || null,
    domain: env.DOMAIN,
    indexerPollIntervalMs: env.INDEXER_POLL_INTERVAL_MS,
    reconciliationIntervalMs: env.RECONCILIATION_INTERVAL_MS,
    adminApiKey,
  };
}