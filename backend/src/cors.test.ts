import { describe, it, expect, vi } from "vitest";
import request from "supertest";

vi.hoisted(() => {
  process.env.ALLOWED_ORIGINS = "https://allowed.example.com";
});

vi.mock("./services/db", () => ({
  getDb: vi.fn(),
}));
vi.mock("./services/metrics", () => ({
  eventsIndexedTotal: { inc: vi.fn() },
  ledgersScannedTotal: { inc: vi.fn() },
  lastIndexedLedger: { set: vi.fn() },
  indexerErrorsTotal: { inc: vi.fn() },
  indexerCircuitState: { set: vi.fn() },
  recordIndexerSuccess: vi.fn(),
  httpRequestsTotal: { inc: vi.fn() },
  httpRequestDurationMs: { observe: vi.fn() },
  streamCountByStatus: { set: vi.fn() },
  claimCount: { set: vi.fn() },
  cancelCount: { set: vi.fn() },
  indexerLagSeconds: { set: vi.fn() },
  refreshPrometheusStreamMetrics: vi.fn(),
  resetPrometheusStreamMetricsCache: vi.fn(),
  resetIndexerLag: vi.fn(),
}));

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(() => ({
        getLatestLedger: vi.fn(),
        simulateTransaction: vi.fn(),
        prepareTransaction: vi.fn(),
      })),
      Api: {
        ...actual.rpc.Api,
        isSimulationSuccess: (response: any) => response.kind === "success",
      },
    },
  };
});

import { app } from "./index";

describe("CORS Configuration", () => {
  it("should allow requests from allowed origin", async () => {
    const response = await request(app)
      .options("/api/health")
      .set("Origin", "https://allowed.example.com")
      .set("Access-Control-Request-Method", "GET");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://allowed.example.com");
  });

  it("should reject unknown origin with 403 on preflight", async () => {
    const response = await request(app)
      .options("/api/health")
      .set("Origin", "https://evil.com")
      .set("Access-Control-Request-Method", "GET");

    expect(response.status).toBe(403);
  });
});
