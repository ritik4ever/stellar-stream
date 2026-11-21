import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // setupFiles runs in each worker process before any test module is
    // imported, guaranteeing that env vars are set before rate limiters and
    // other module-level initialisations read them from process.env.
    setupFiles: ["src/test-setup.ts"],
    // Run each test file in its own forked process so module-level state
    // (rate limiters, DB singletons, env vars) is fully isolated.
    pool: "forks",
    isolate: true,
    // Coverage configuration to enforce 80% branch coverage threshold
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/**/*.tsx"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/test-setup.ts",
      ],
      thresholds: {
        branches: 80,
        lines: 80,
        functions: 80,
        statements: 80,
      },
      reporter: ["text", "json", "html"],
      reportsDirectory: "coverage",
      all: true,
    },
  },
});
