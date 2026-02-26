import { getDb } from "./db";

export type StreamEventType = "created" | "claimed" | "canceled" | "start_time_updated";

export interface StreamEvent {
  id: number;
  streamId: string;
  eventType: StreamEventType;
  timestamp: number;
  actor?: string;
  amount?: number;
  metadata?: Record<string, any>;
}

interface EventRow {
  id: number;
  stream_id: string;
  event_type: string;
  timestamp: number;
  actor: string | null;
  amount: number | null;
  metadata: string | null;
}

function rowToEvent(row: EventRow): StreamEvent {
  return {
    id: row.id,
    streamId: row.stream_id,
    eventType: row.event_type as StreamEventType,
    timestamp: row.timestamp,
    actor: row.actor ?? undefined,
    amount: row.amount ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}

export function recordEvent(
  streamId: string,
  eventType: StreamEventType,
  timestamp: number,
  actor?: string,
  amount?: number,
  metadata?: Record<string, any>,
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO stream_events (stream_id, event_type, timestamp, actor, amount, metadata)
     VALUES (@streamId, @eventType, @timestamp, @actor, @amount, @metadata)`,
  ).run({
    streamId,
    eventType,
    timestamp,
    actor: actor ?? null,
    amount: amount ?? null,
    metadata: metadata ? JSON.stringify(metadata) : null,
  });
}

export function getStreamHistory(streamId: string): StreamEvent[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM stream_events WHERE stream_id = ? ORDER BY timestamp ASC, id ASC`,
    )
    .all(streamId) as EventRow[];
  return rows.map(rowToEvent);
}

export function getAllEvents(limit = 100, offset = 0): StreamEvent[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM stream_events ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as EventRow[];
  return rows.map(rowToEvent);
}
