import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import path from "path";
import fs from "fs";

const webhookMocks = vi.hoisted(() => ({
  triggerWebhook: vi.fn(),
}));

vi.mock("./webhook", () => webhookMocks);

import { initDb, getDb } from "./db";
import { getStreamHistory } from "./eventHistory";
import { refreshStreamStatuses } from "./streamStore";

const TEST_DB_PATH = path.join(
  __dirname,
  "..",
  "..",
  "data",
  "test-refresh-stream-statuses.db",
);

const SENDER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const RECIPIENT = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function insertExpiredStream(id: string): void {
  const now = Math.floor(Date.now() / 1000);
  getDb()
    .prepare(`
      INSERT INTO streams (
        id, sender, recipient, asset_code, total_amount,
        duration_seconds, start_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(id, SENDER, RECIPIENT, "USDC", 1000, 3600, now - 7200, now - 7200);
}

describe("refreshStreamStatuses", () => {
  beforeAll(() => {
    process.env.DB_PATH = TEST_DB_PATH;
    initDb();
  });

  beforeEach(() => {
    const db = getDb();
    db.exec("DELETE FROM stream_events");
    db.exec("DELETE FROM webhook_deliveries");
    db.exec("DELETE FROM streams");
    webhookMocks.triggerWebhook.mockClear();
  });

  afterAll(() => {
    getDb().close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  it("completes expired streams, records events, and queues webhooks after commit", () => {
    insertExpiredStream("refresh-success");

    expect(refreshStreamStatuses()).toBe(1);

    const stream = getDb()
      .prepare("SELECT completed_at FROM streams WHERE id = ?")
      .get("refresh-success") as { completed_at: number | null };
    expect(stream.completed_at).not.toBeNull();
    expect(getStreamHistory("refresh-success")).toMatchObject([
      { eventType: "completed", streamId: "refresh-success" },
    ]);
    expect(webhookMocks.triggerWebhook).toHaveBeenCalledTimes(1);
  });

  it("rolls back every stream and event when a completion event insert fails", () => {
    insertExpiredStream("refresh-first");
    insertExpiredStream("refresh-second");
    getDb().exec(`
      CREATE TRIGGER fail_second_completion_event
      BEFORE INSERT ON stream_events
      WHEN NEW.stream_id = 'refresh-second' AND NEW.event_type = 'completed'
      BEGIN
        SELECT RAISE(ABORT, 'forced completion event failure');
      END;
    `);

    try {
      expect(() => refreshStreamStatuses()).toThrow("forced completion event failure");

      const rows = getDb()
        .prepare("SELECT id, completed_at FROM streams ORDER BY id")
        .all() as Array<{ id: string; completed_at: number | null }>;
      expect(rows).toEqual([
        { id: "refresh-first", completed_at: null },
        { id: "refresh-second", completed_at: null },
      ]);
      expect(getStreamHistory("refresh-first")).toHaveLength(0);
      expect(getStreamHistory("refresh-second")).toHaveLength(0);
      expect(webhookMocks.triggerWebhook).not.toHaveBeenCalled();
    } finally {
      getDb().exec("DROP TRIGGER IF EXISTS fail_second_completion_event");
    }
  });

  it("can retry a failed batch and does not duplicate completion events", () => {
    insertExpiredStream("refresh-retry");
    getDb().exec(`
      CREATE TRIGGER fail_retry_completion_event
      BEFORE INSERT ON stream_events
      WHEN NEW.stream_id = 'refresh-retry' AND NEW.event_type = 'completed'
      BEGIN
        SELECT RAISE(ABORT, 'forced retry event failure');
      END;
    `);

    try {
      expect(() => refreshStreamStatuses()).toThrow("forced retry event failure");
      expect(getStreamHistory("refresh-retry")).toHaveLength(0);
      expect(webhookMocks.triggerWebhook).not.toHaveBeenCalled();
    } finally {
      getDb().exec("DROP TRIGGER IF EXISTS fail_retry_completion_event");
    }

    expect(refreshStreamStatuses()).toBe(1);
    expect(refreshStreamStatuses()).toBe(0);
    expect(getStreamHistory("refresh-retry")).toHaveLength(1);
    expect(webhookMocks.triggerWebhook).toHaveBeenCalledTimes(1);
  });
});
