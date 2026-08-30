import { getDb } from "./db";

export type StreamEventType = "created" | "claimed" | "canceled" | "start_time_updated" | "paused" | "resumed" | "completed" | "transferred" | "clawback";

export interface StreamEvent {
  id: number;
  streamId: string;
  eventType: StreamEventType;
  ledgerSequence?: number;
  timestamp: number;
  actor?: string;
  amount?: number;
  metadata?: Record<string, any>;
}

interface EventRow {
  id: number;
  stream_id: string;
  event_type: string;
  ledger_sequence: number | null;
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
    ledgerSequence: row.ledger_sequence ?? undefined,
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
  ledgerSequence?: number,
): void {
  const db = getDb();
  recordEventWithDb(db, streamId, eventType, timestamp, actor, amount, metadata, ledgerSequence);
}

/**
 * Insert a stream event using a caller-supplied db handle (or transaction).
 * Uses INSERT OR IGNORE so duplicate (stream_id, event_type, ledger_sequence)
 * rows are silently skipped — safe to call on indexer restart.
 */
export function recordEventWithDb(
  db: any,
  streamId: string,
  eventType: StreamEventType,
  timestamp: number,
  actor?: string,
  amount?: number,
  metadata?: Record<string, any>,
  ledgerSequence?: number,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO stream_events (stream_id, event_type, ledger_sequence, timestamp, actor, amount, metadata)
     VALUES (@streamId, @eventType, @ledgerSequence, @timestamp, @actor, @amount, @metadata)`,
  ).run({
    streamId,
    eventType,
    ledgerSequence: ledgerSequence ?? null,
    timestamp,
    actor: actor ?? null,
    amount: amount ?? null,
    metadata: metadata ? JSON.stringify(metadata) : null,
  });
}

export function getStreamHistory(streamId: string, limit = 20, offset = 0, order: 'asc' | 'desc' = 'desc'): StreamEvent[] {
  const db = getDb();
  const orderClause = order === 'asc' ? 'ASC' : 'DESC';
  const rows = db
    .prepare(
      `SELECT * FROM stream_events WHERE stream_id = ? ORDER BY timestamp ${orderClause}, id ${orderClause} LIMIT ? OFFSET ?`,
    )
    .all(streamId, limit, offset) as EventRow[];
  return rows.map(rowToEvent);
}

export function getAllEvents(limit = 100, offset = 0, cursor?: number): StreamEvent[] {
  const db = getDb();
  let query = `SELECT * FROM stream_events`;
  const params: any[] = [];

  if (cursor !== undefined) {
    query += ` WHERE id < ?`;
    params.push(cursor);
  }

  query += ` ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params) as EventRow[];
  return rows.map(rowToEvent);
}

export function getGlobalEvents(
  limit: number,
  offset: number,
  eventType?: StreamEventType,
  cursor?: number,
  streamId?: string,
  since?: number,
): StreamEvent[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (eventType) {
    conditions.push("event_type = ?");
    params.push(eventType);
  }

  if (cursor !== undefined) {
    conditions.push("id < ?");
    params.push(cursor);
  }

  if (streamId) {
    conditions.push("stream_id = ?");
    params.push(streamId);
  }

  if (since !== undefined) {
    conditions.push("timestamp > ?");
    params.push(since);
  }

  let query = "SELECT * FROM stream_events";
  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }
  query += " ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params) as EventRow[];
  return rows.map(rowToEvent);
}

export function countAllEvents(
  eventType?: StreamEventType,
  streamId?: string,
  since?: number,
): number {
  const db = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (eventType) {
    conditions.push("event_type = ?");
    params.push(eventType);
  }

  if (streamId) {
    conditions.push("stream_id = ?");
    params.push(streamId);
  }

  if (since !== undefined) {
    conditions.push("timestamp > ?");
    params.push(since);
  }

  let query = "SELECT COUNT(*) as count FROM stream_events";
  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  const row = db.prepare(query).get(...params) as { count: number };
  return row.count;
}

export function countStreamEvents(streamId: string): number {
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM stream_events WHERE stream_id = ?`)
    .get(streamId) as { count: number };
  return row.count;
}

export interface StreamEventSummary {
  totalEvents: number;
  byType: Partial<Record<StreamEventType, number>>;
  firstEventAt?: number;
  lastEventAt?: number;
}

export function getStreamEventSummary(streamId: string): StreamEventSummary {
  const db = getDb();

  const countRows = db
    .prepare(
      `SELECT event_type, COUNT(*) as count FROM stream_events WHERE stream_id = ? GROUP BY event_type`,
    )
    .all(streamId) as Array<{ event_type: string; count: number }>;

  const byType: Partial<Record<StreamEventType, number>> = {};
  let totalEvents = 0;
  for (const row of countRows) {
    byType[row.event_type as StreamEventType] = row.count;
    totalEvents += row.count;
  }

  const bounds = db
    .prepare(
      `SELECT MIN(timestamp) as first, MAX(timestamp) as last FROM stream_events WHERE stream_id = ?`,
    )
    .get(streamId) as { first: number | null; last: number | null };

  return {
    totalEvents,
    byType,
    firstEventAt: bounds.first ?? undefined,
    lastEventAt: bounds.last ?? undefined,
  };
}

export function streamHasEvent(
  streamId: string,
  eventType: StreamEventType,
): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT 1 as present FROM stream_events WHERE stream_id = ? AND event_type = ? LIMIT 1`,
    )
    .get(streamId, eventType) as { present: number } | undefined;

  return row !== undefined;
}
