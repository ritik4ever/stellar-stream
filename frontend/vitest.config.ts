import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "happy-dom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/setupTests.ts"],
    server: {
      deps: {
        // Force ESM packages through Vite's transform pipeline
        // so they don't hit Node's require() path
        inline: ["msw", "@mswjs/interceptors"],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.test.*",
        "src/**/*.d.ts",
        "src/vite-env.d.ts",
        "src/node-verify.js",
        "src/main.tsx",
        "src/server.ts",
      ],
    },
  },
});
