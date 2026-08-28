import { describe, it, expect, vi } from "vitest";
import request from "supertest";

// METRICS_AUTH is read from the environment at module load time, so it must
// be set before the app module is imported.
vi.hoisted(() => {
  process.env.METRICS_AUTH = "metrics:test-secret";
});

import { app } from "./index";

const AUTH_HEADER = "Basic " + Buffer.from("metrics:test-secret").toString("base64");
const WRONG_AUTH_HEADER = "Basic " + Buffer.from("metrics:wrong-password").toString("base64");

describe("GET /metrics", () => {
  it("returns 401 for unauthenticated scrapes when METRICS_AUTH is set", async () => {
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain("Basic");
  });

  it("returns 401 for scrapes with wrong credentials", async () => {
    const res = await request(app).get("/metrics").set("Authorization", WRONG_AUTH_HEADER);
    expect(res.status).toBe(401);
  });

  it("serves Prometheus text format with all required metric families", async () => {
    const res = await request(app).get("/metrics").set("Authorization", AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.headers["content-type"]).toContain("version=0.0.4");

    for (const name of [
      "request_count",
      "request_duration_ms",
      "stream_count",
      "claim_count",
      "cancel_count",
      "indexer_lag_seconds",
      "events_indexed_total",
    ]) {
      expect(res.text).toContain(name);
    }
  });

  it("records request metrics observed by the request logger", async () => {
    await request(app).get("/api/health");
    await request(app).get("/api/health");

    const res = await request(app).get("/metrics").set("Authorization", AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.text).toContain(
      'request_count{method="GET",route="/api/health",status_code="200"} 2',
    );
    expect(res.text).toContain("request_duration_ms_count");
    expect(res.text).toContain("request_duration_ms_bucket");
  });
});
