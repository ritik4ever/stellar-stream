import Database from "better-sqlite3";
import {
  SQLITE_DEFAULT_READ_POOL_SIZE,
  SQLITE_MAX_READ_POOL_SIZE,
  SqliteConnectionRole,
} from "./constants";
import {
  applySqlitePragmas,
  DEFAULT_SQLITE_PRAGMA_SETTINGS,
  type SqlitePragmaSettings,
} from "./apply-pragmas";

export interface SqlitePoolOptions {
  filePath: string;
  readPoolSize?: number;
  pragmas?: SqlitePragmaSettings;
}

export function isFileBackedSqlitePath(filePath: string): boolean {
  const normalized = filePath.trim().toLowerCase();
  return normalized !== ":memory:" && !normalized.startsWith("file::memory:");
}

function resolveReadPoolSize(filePath: string, requested?: number): number {
  if (!isFileBackedSqlitePath(filePath)) {
    return 0;
  }
  const size = requested ?? SQLITE_DEFAULT_READ_POOL_SIZE;
  return Math.max(0, Math.min(SQLITE_MAX_READ_POOL_SIZE, size));
}

export class SqliteConnectionPool {
  readonly writer: any;
  private readonly readers: any[];
  private readerCursor = 0;

  constructor(options: SqlitePoolOptions) {
    const pragmas = options.pragmas ?? DEFAULT_SQLITE_PRAGMA_SETTINGS;
    this.writer = new Database(options.filePath);
    applySqlitePragmas(this.writer, pragmas, SqliteConnectionRole.Writer);

    const readPoolSize = resolveReadPoolSize(options.filePath, options.readPoolSize);
    this.readers = [];
    for (let i = 0; i < readPoolSize; i += 1) {
      const reader = new Database(options.filePath, { readonly: true });
      applySqlitePragmas(reader, pragmas, SqliteConnectionRole.Reader);
      this.readers.push(reader);
    }
  }

  getWriter(): any {
    return this.writer;
  }

  getReader(): any {
    if (this.readers.length === 0) {
      return this.writer;
    }
    const reader = this.readers[this.readerCursor % this.readers.length];
    this.readerCursor = (this.readerCursor + 1) % this.readers.length;
    return reader;
  }

  close(): void {
    for (const reader of this.readers) {
      closeQuietly(reader);
    }
    this.readers.length = 0;
    closeQuietly(this.writer);
  }
}

function closeQuietly(connection: { close: () => void }): void {
  try {
    connection.close();
  } catch {
    return;
  }
}
