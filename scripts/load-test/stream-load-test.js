#!/usr/bin/env k6
/**
 * Load test for stream create, list, and cancel endpoints.
 *
 * Usage:
 *   k6 run scripts/load-test/stream-load-test.js
 *
 * Environment variables:
 *   BASE_URL       Base URL of the backend API (default: http://localhost:3001)
 *   JWT_SECRET     Secret used to sign JWTs (must match the backend's JWT_SECRET)
 *   VUS            Max concurrent users (default: 200)
 *   DURATION       Test duration (default: 5m)
 *
 * SLOs (enforced via thresholds):
 *   - p95 latency < 200ms for all covered endpoints
 *   - error rate < 0.5%
 *
 * The script generates a valid JWT locally using the same JWT_SECRET the
 * backend uses, so no external Horizon interaction is required. It ramps
 * from 10 to the configured max concurrent users.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";
import { SharedArray } from "k6/data";
import crypto from "k6/crypto";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const JWT_SECRET = __ENV.JWT_SECRET || "test_secret_for_load_test";
const MAX_VUS = Number(__ENV.VUS || 200);
const DURATION = __ENV.DURATION || "5m";

// ---- Custom metrics for percentile breakdown per endpoint ----
const createLatency = new Trend("http_req_duration_create", true);
const listLatency = new Trend("http_req_duration_list", true);
const cancelLatency = new Trend("http_req_duration_cancel", true);
const createErrors = new Rate("create_errors");
const listErrors = new Rate("list_errors");
const cancelErrors = new Rate("cancel_errors");
const streamsCreated = new Counter("streams_created");
const streamsCancelled = new Counter("streams_cancelled");

// ---- SLO thresholds ----
export const options = {
  scenarios: {
    ramp_up: {
      executor: "ramping-vus",
      startVUs: 10,
      stages: [
        { duration: "1m", target: Math.round(MAX_VUS / 2) },
        { duration: "1m", target: MAX_VUS },
        { duration: DURATION, target: MAX_VUS },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    // SLO: p95 latency < 200ms for every covered endpoint
    http_req_duration_create: ["p(95)<200"],
    http_req_duration_list: ["p(95)<200"],
    http_req_duration_cancel: ["p(95)<200"],
    // SLO: error rate < 0.5%
    create_errors: ["rate<0.005"],
    list_errors: ["rate<0.005"],
    cancel_errors: ["rate<0.005"],
    // Overall error rate must stay under 0.5%
    http_req_failed: ["rate<0.005"],
  },
};

// ---- Deterministic test accounts (valid Stellar public keys) ----
const SENDER = "GCLJJD5FHTSEBHFXAA3BBTODUJ4RXDK6B3OSVNKY6TUHF76AQQT2WNFC";
const RECIPIENT = "GDL7R4FQ6XQ7Q7Q7Q7Q7Q7Q7Q7Q7Q7Q7Q7Q7Q7Q7Q7Q7Q7Q7Q7Q7Q7Q7Q7Q7Q7Q7";

// ---- JWT generation (mirrors backend/src/services/auth.ts) ----
// The backend signs JWTs with HS256 using JWT_SECRET. We replicate that here
// so the load test can mint valid tokens without hitting Horizon.
function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signJwt(accountId) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      accountId,
      iat: now,
      exp: now + 3600, // 1 hour
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = crypto.hmac("sha256", JWT_SECRET, signingInput, "base64url");
  return `${signingInput}.${signature}`;
}

// ---- Pre-generate a pool of JWTs (one per virtual user) ----
const tokens = new SharedArray("tokens", function () {
  const arr = [];
  for (let i = 0; i < MAX_VUS; i++) {
    arr.push(signJwt(SENDER));
  }
  return arr;
});

// ---- Payload helpers ----
function createStreamPayload() {
  const now = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    sender: SENDER,
    recipient: RECIPIENT,
    assetCode: "USDC",
    totalAmount: 1000 + Math.floor(Math.random() * 9000),
    durationSeconds: 3600 * 24 * 30, // 30 days
    startAt: now + 60,
  });
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// ---- Main test ----
export default function () {
  const token = tokens[__VU - 1];
  const headers = authHeaders(token);

  // 1) POST /api/streams — create a stream
  const createRes = http.post(
    `${BASE_URL}/api/streams`,
    createStreamPayload(),
    { headers },
  );
  createLatency.add(createRes.timings.duration);
  const createOk = check(createRes, {
    "create returns 201": (r) => r.status === 201,
  });
  createErrors.add(!createOk);
  if (createOk) {
    streamsCreated.add(1);
  }

  // 2) GET /api/streams — list streams
  const listRes = http.get(`${BASE_URL}/api/streams?limit=20`, { headers });
  listLatency.add(listRes.timings.duration);
  const listOk = check(listRes, {
    "list returns 200": (r) => r.status === 200,
  });
  listErrors.add(!listOk);

  // 3) POST /api/streams/:id/cancel — cancel the stream we just created
  if (createOk) {
    const streamId = createRes.json("data.id");
    const cancelRes = http.post(
      `${BASE_URL}/api/streams/${streamId}/cancel`,
      null,
      { headers },
    );
    cancelLatency.add(cancelRes.timings.duration);
    const cancelOk = check(cancelRes, {
      "cancel returns 200": (r) => r.status === 200,
    });
    cancelErrors.add(!cancelOk);
    if (cancelOk) {
      streamsCancelled.add(1);
    }
  }

  sleep(1);
}
