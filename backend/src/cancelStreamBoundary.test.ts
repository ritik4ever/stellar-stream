import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { app } from "./index";
import { getDb, initDb } from "./services/db";
import { initCache } from "./services/cache";
import { getClaimedTotal, getStreamHistory } from "./services/eventHistory";
import { getJwtSecret } from "./services/auth";

/**
 * SSB-2026-096 / #1038 — Cancel stream endpoint boundary behavior.
 *
 * Pins the observable contract around repeated cancellation of completed
 * streams and cancellation racing with a claim: deterministic status codes,
 * explicit outcome headers, and no silent mutation of final status, timestamps,
 * refunds, or event history.
 */

const TEST_DB_PATH = path.join(
  __dirname,
  "..",
  "data",
  "test-cancel-boundary.db",
);

const SENDER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const RECIPIENT = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

let authToken: string;

function insertStream(row: Record<string, unknown>) {
  const db = getDb();
  const columns = Object.keys(row);
  const values = columns.map((column) => `@${column}`).join(", ");
  db.prepare(
    `INSERT INTO streams (${columns.join(", ")}) VALUES (${values})`,
  ).run(row);
}

describe("POST /api/streams/:id/cancel boundary behavior (SSB-2026-096 / #1038)", () => {
  beforeAll(() => {
    process.env.DB_PATH = TEST_DB_PATH;
    initDb();
    initCache();
    authToken = jwt.sign({ accountId: SENDER }, getJwtSecret(), {
      expiresIn: "1h",
    });
  });

  beforeEach(() => {
    const db = getDb();
    db.exec("DELETE FROM stream_events");
    db.exec("DELETE FROM webhook_deliveries");
    db.exec("DELETE FROM streams");
  });

  afterAll(() => {
    const db = getDb();
    db.close();

    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  it("replays a repeated cancel on a completed stream without changing final state", async () => {
    const now = Math.floor(Date.now() / 1000);
    const completedAt = now - 3600;

    insertStream({
      id: "2001",
      sender: SENDER,
      recipient: RECIPIENT,
      asset_code: "USDC",
      total_amount: 1000,
      duration_seconds: 3600,
      start_at: now - 7200,
      created_at: now - 10800,
      completed_at: completedAt,
    });

    const first = await request(app)
      .post("/api/streams/2001/cancel")
      .set("Authorization", `Bearer ${authToken}`);

    // First cancel is a committed state change on a completed stream.
    expect(first.status).toBe(200);
    expect(first.headers["x-cancel-outcome"]).toBe("already_completed");
    expect(first.headers["x-cancel-outcome-code"]).toBe("2");
    expect(first.headers["x-idempotent-replay"]).toBeUndefined();
    expect(first.body.data.completedAt).toBe(completedAt);
    expect(first.body.data.refundedAmount).toBe(0);
    expect(first.body.data.progress.status).toBe("canceled");

    const canceledAt = first.body.data.canceledAt;
    expect(canceledAt).toBeDefined();

    const second = await request(app)
      .post("/api/streams/2001/cancel")
      .set("Authorization", `Bearer ${authToken}`);

    // Repeat cancel is an explicit replay: 200, unchanged record, no writes.
    expect(second.status).toBe(200);
    expect(second.headers["x-cancel-outcome"]).toBe("already_canceled");
    expect(second.headers["x-cancel-outcome-code"]).toBe("1");
    expect(second.headers["x-idempotent-replay"]).toBe("true");
    expect(second.body.data).toMatchObject({
      id: "2001",
      canceledAt,
      completedAt,
      refundedAmount: 0,
      progress: { status: "canceled" },
    });

    const stored = getDb()
      .prepare(
        "SELECT canceled_at, completed_at, refunded_amount FROM streams WHERE id = ?",
      )
      .get("2001");
    expect(stored.canceled_at).toBe(canceledAt);
    expect(stored.completed_at).toBe(completedAt);
    expect(stored.refunded_amount).toBe(0);
    expect(
      getStreamHistory("2001").filter((event) => event.eventType === "canceled"),
    ).toHaveLength(1);
  });

  it("treats an elapsed-duration stream as completed and refunds nothing", async () => {
    const now = Math.floor(Date.now() / 1000);

    insertStream({
      id: "2002",
      sender: SENDER,
      recipient: RECIPIENT,
      asset_code: "USDC",
      total_amount: 1000,
      duration_seconds: 3600,
      start_at: now - 7200,
      created_at: now - 10800,
    });

    const first = await request(app)
      .post("/api/streams/2002/cancel")
      .set("Authorization", `Bearer ${authToken}`);

    expect(first.status).toBe(200);
    expect(first.headers["x-cancel-outcome"]).toBe("already_completed");
    expect(first.body.data.refundedAmount).toBe(0);
    expect(first.body.data.progress.status).toBe("canceled");
    expect(first.body.data.progress.vestedAmount).toBeCloseTo(1000, 3);

    const second = await request(app)
      .post("/api/streams/2002/cancel")
      .set("Authorization", `Bearer ${authToken}`);

    expect(second.status).toBe(200);
    expect(second.headers["x-idempotent-replay"]).toBe("true");
    expect(second.body.data.canceledAt).toBe(first.body.data.canceledAt);
    expect(second.body.data.refundedAmount).toBe(0);
    expect(
      getStreamHistory("2002").filter((event) => event.eventType === "canceled"),
    ).toHaveLength(1);
  });

  it("preserves a claim and the settled refund across repeated cancels", async () => {
    const now = Math.floor(Date.now() / 1000);

    insertStream({
      id: "2003",
      sender: SENDER,
      recipient: RECIPIENT,
      asset_code: "USDC",
      total_amount: 1000,
      duration_seconds: 3600,
      start_at: now - 1800,
      created_at: now - 3600,
    });

    const claimedAmount = 400;
    getDb()
      .prepare(
        "INSERT INTO stream_events (stream_id, event_type, timestamp, actor, amount) VALUES (?, 'claimed', ?, ?, ?)",
      )
      .run("2003", now - 100, RECIPIENT, claimedAmount);

    const first = await request(app)
      .post("/api/streams/2003/cancel")
      .set("Authorization", `Bearer ${authToken}`);

    expect(first.status).toBe(200);
    expect(first.headers["x-cancel-outcome"]).toBe("success");
    expect(first.headers["x-idempotent-replay"]).toBeUndefined();
    expect(first.body.data.progress.status).toBe("canceled");
    expect(getClaimedTotal("2003")).toBe(claimedAmount);

    const committedRefund = first.body.data.refundedAmount;
    expect(committedRefund).toBeGreaterThan(0);
    expect(
      committedRefund + first.body.data.progress.vestedAmount,
    ).toBeCloseTo(1000, 3);

    const second = await request(app)
      .post("/api/streams/2003/cancel")
      .set("Authorization", `Bearer ${authToken}`);

    expect(second.status).toBe(200);
    expect(second.headers["x-cancel-outcome"]).toBe("already_canceled");
    expect(second.headers["x-idempotent-replay"]).toBe("true");
    expect(second.body.data.canceledAt).toBe(first.body.data.canceledAt);
    expect(second.body.data.refundedAmount).toBe(committedRefund);
    expect(getClaimedTotal("2003")).toBe(claimedAmount);

    const history = getStreamHistory("2003");
    expect(history.filter((event) => event.eventType === "claimed")).toHaveLength(
      1,
    );
    expect(history.filter((event) => event.eventType === "canceled")).toHaveLength(
      1,
    );
  });

  it("returns a deterministic validation error for a malformed stream id", async () => {
    const response = await request(app)
      .post("/api/streams/not-a-number/cancel")
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(response.headers["x-cancel-outcome"]).toBeUndefined();
  });

  it("refunds the full amount when cancelling a scheduled stream", async () => {
    const now = Math.floor(Date.now() / 1000);

    insertStream({
      id: "2004",
      sender: SENDER,
      recipient: RECIPIENT,
      asset_code: "USDC",
      total_amount: 1000,
      duration_seconds: 3600,
      start_at: now + 3600,
      created_at: now,
    });

    const response = await request(app)
      .post("/api/streams/2004/cancel")
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.headers["x-cancel-outcome"]).toBe("success");
    expect(response.body.data.refundedAmount).toBe(1000);
    expect(response.body.data.progress.status).toBe("canceled");
  });

  it("rejects a non-sender without mutating the stream", async () => {
    const now = Math.floor(Date.now() / 1000);

    insertStream({
      id: "2005",
      sender: SENDER,
      recipient: RECIPIENT,
      asset_code: "USDC",
      total_amount: 1000,
      duration_seconds: 3600,
      start_at: now - 1800,
      created_at: now - 3600,
    });

    const recipientToken = jwt.sign(
      { accountId: RECIPIENT },
      getJwtSecret(),
      { expiresIn: "1h" },
    );

    const response = await request(app)
      .post("/api/streams/2005/cancel")
      .set("Authorization", `Bearer ${recipientToken}`);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("FORBIDDEN");
    expect(response.headers["x-cancel-outcome"]).toBeUndefined();

    const stored = getDb()
      .prepare(
        "SELECT canceled_at, refunded_amount FROM streams WHERE id = ?",
      )
      .get("2005");
    expect(stored.canceled_at).toBeNull();
    expect(stored.refunded_amount).toBeNull();
    expect(getStreamHistory("2005")).toHaveLength(0);
  });
});
