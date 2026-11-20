import { getDb } from "./db";

export interface StreamNote {
  id: number;
  streamId: string;
  author: string;
  content: string;
  createdAt: number;
}

interface NoteRow {
  id: number;
  stream_id: string;
  author: string;
  content: string;
  created_at: number;
}

function rowToNote(row: NoteRow): StreamNote {
  return {
    id: row.id,
    streamId: row.stream_id,
    author: row.author,
    content: row.content,
    createdAt: row.created_at,
  };
}

export function addNote(
  streamId: string,
  author: string,
  content: string,
  createdAt: number,
): StreamNote {
  const db = getDb();
  db.prepare(
    `INSERT INTO stream_notes (stream_id, author, content, created_at)
     VALUES (@streamId, @author, @content, @createdAt)`,
  ).run({ streamId, author, content, createdAt });

  const row = db
    .prepare(
      `SELECT * FROM stream_notes WHERE stream_id = ? AND author = ? AND created_at = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(streamId, author, createdAt) as NoteRow;

  return rowToNote(row);
}

export function getNotes(
  streamId: string,
  limit: number,
  offset: number,
): StreamNote[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM stream_notes WHERE stream_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(streamId, limit, offset) as NoteRow[];
  return rows.map(rowToNote);
}

export function countNotes(streamId: string): number {
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM stream_notes WHERE stream_id = ?`)
    .get(streamId) as { count: number };
  return row.count;
}
