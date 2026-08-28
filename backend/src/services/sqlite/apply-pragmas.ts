import {
  SQLITE_BUSY_TIMEOUT_MS,
  SQLITE_CACHE_SIZE_KIB,
  SQLITE_MMAP_SIZE_BYTES,
  SQLITE_WAL_AUTOCHECKPOINT_PAGES,
  SqliteConnectionRole,
  SqliteForeignKeys,
  SqliteJournalMode,
  SqlitePragma,
  SqliteSynchronous,
  SqliteTempStore,
} from "./constants";

export interface SqliteQueryable {
  pragma(source: string): unknown;
}

export interface SqlitePragmaSettings {
  journalMode: SqliteJournalMode;
  synchronous: SqliteSynchronous;
  busyTimeoutMs: number;
  cacheSizeKib: number;
  foreignKeys: SqliteForeignKeys;
  tempStore: SqliteTempStore;
  walAutocheckpointPages: number;
  mmapSizeBytes: number;
}

export const DEFAULT_SQLITE_PRAGMA_SETTINGS: SqlitePragmaSettings = {
  journalMode: SqliteJournalMode.Wal,
  synchronous: SqliteSynchronous.Normal,
  busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
  cacheSizeKib: SQLITE_CACHE_SIZE_KIB,
  foreignKeys: SqliteForeignKeys.On,
  tempStore: SqliteTempStore.Memory,
  walAutocheckpointPages: SQLITE_WAL_AUTOCHECKPOINT_PAGES,
  mmapSizeBytes: SQLITE_MMAP_SIZE_BYTES,
};

export interface AppliedSqlitePragmas {
  journalMode: string;
  synchronous: number | string;
  busyTimeoutMs: number;
  cacheSize: number;
  foreignKeys: number;
  tempStore: number | string;
  walAutocheckpoint: number;
  mmapSize: number;
}

function pragmaScalar(db: SqliteQueryable, name: SqlitePragma): string | number {
  const result = db.pragma(name);
  if (Array.isArray(result) && result.length > 0 && typeof result[0] === "object" && result[0] !== null) {
    const values = Object.values(result[0] as Record<string, unknown>);
    const value = values[0];
    if (typeof value === "number" || typeof value === "string") {
      return value;
    }
  }
  if (typeof result === "number" || typeof result === "string") {
    return result;
  }
  throw new Error(`Unexpected PRAGMA ${name} result`);
}

export function applySqlitePragmas(
  db: SqliteQueryable,
  settings: SqlitePragmaSettings = DEFAULT_SQLITE_PRAGMA_SETTINGS,
  role: SqliteConnectionRole = SqliteConnectionRole.Writer,
): AppliedSqlitePragmas {
  if (role === SqliteConnectionRole.Writer) {
    db.pragma(`${SqlitePragma.JournalMode} = ${settings.journalMode}`);
    db.pragma(`${SqlitePragma.Synchronous} = ${settings.synchronous}`);
    db.pragma(`${SqlitePragma.ForeignKeys} = ${settings.foreignKeys}`);
    db.pragma(`${SqlitePragma.TempStore} = ${settings.tempStore}`);
    db.pragma(`${SqlitePragma.WalAutocheckpoint} = ${settings.walAutocheckpointPages}`);
    db.pragma(`${SqlitePragma.MmapSize} = ${settings.mmapSizeBytes}`);
  }
  db.pragma(`${SqlitePragma.BusyTimeout} = ${settings.busyTimeoutMs}`);
  db.pragma(`${SqlitePragma.CacheSize} = ${settings.cacheSizeKib}`);
  return readSqlitePragmas(db);
}

export function readSqlitePragmas(db: SqliteQueryable): AppliedSqlitePragmas {
  return {
    journalMode: String(pragmaScalar(db, SqlitePragma.JournalMode)).toLowerCase(),
    synchronous: pragmaScalar(db, SqlitePragma.Synchronous),
    busyTimeoutMs: Number(pragmaScalar(db, SqlitePragma.BusyTimeout)),
    cacheSize: Number(pragmaScalar(db, SqlitePragma.CacheSize)),
    foreignKeys: Number(pragmaScalar(db, SqlitePragma.ForeignKeys)),
    tempStore: pragmaScalar(db, SqlitePragma.TempStore),
    walAutocheckpoint: Number(pragmaScalar(db, SqlitePragma.WalAutocheckpoint)),
    mmapSize: Number(pragmaScalar(db, SqlitePragma.MmapSize)),
  };
}
