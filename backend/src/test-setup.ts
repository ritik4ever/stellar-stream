/**
 * Global test setup — runs once per worker process before any test files are
 * imported. Setting environment variables here guarantees they are visible
 * to every module that reads them at import / module-initialisation time
 * (e.g. Express rate limiters constructed from process.env in index.ts).
 */

// Disable Soroban integration – no deployed contract needed for tests
process.env.SOROBAN_DISABLED = "true";

// Set rate limits high so they never interfere with auth tests.
// The mutationLimiter is placed before authMiddleware on some routes;
// raising this limit ensures 429 never masks the expected 401.
process.env.MUTATION_RATE_LIMIT = "999999";
process.env.READ_RATE_LIMIT = "999999";
process.env.CLAIMABLE_RATE_LIMIT = "999999";
process.env.AUTH_CHALLENGE_RATE_LIMIT = "999999";

// Stable JWT secret so tokens created across modules are verifiable
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "vitest_global_test_secret_do_not_use_in_production";
}

// Admin API key for tests that exercise adminAuth routes
if (!process.env.ADMIN_API_KEY) {
  process.env.ADMIN_API_KEY = "vitest-admin-key-for-testing";
}
