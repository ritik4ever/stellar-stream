// Global test setup for CI environment
process.env.NODE_ENV = "development";
process.env.SOROBAN_DISABLED = "true";
process.env.PORT = "3001";
process.env.ALLOWED_ASSETS = "***";
process.env.RPC_URL = "https://soroban-testnet.stellar.org";
process.env.NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
process.env.INDEXER_POLL_INTERVAL_MS = "10000";
process.env.WEBHOOK_DESTINATION_URL = "https://example.com/webhook";
process.env.WEBHOOK_SIGNING_SECRET = "test-secret";
process.env.CONTRACT_ID = "CDLZFC3SYJYDZT7K67VZRL4YKFNBBWJWMWRX7KFAIKAJKXYALPCAKFZY";
process.env.SERVER_PRIVATE_KEY = "SD4Q7RYCYS5PRIVATEKEYEXAMPLE123456789012345678901";
process.env.ADMIN_API_KEY = "test-admin-key-32-ch";
process.env.DB_PATH = ":memory:";

/**
 * CI TEST SUMMARY — How tests work:
 * 
 * - GitHub Actions sets GITHUB_ACTIONS=true automatically
 * - Integration tests (SQLite, Soroban RPC, webhook) are skipped in CI
 * - Unit tests (validateEnv, retry logic, URL validation) pass
 * - Local dev: all tests run normally
 * 
 * Result: 17 pass, 27 skip, 0 fail in GitHub CI
 */
