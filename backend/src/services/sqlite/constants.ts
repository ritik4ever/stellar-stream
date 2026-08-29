export enum SqliteJournalMode {
  Wal = "WAL",
}

export enum SqliteSynchronous {
  Normal = "NORMAL",
}

export enum SqliteTempStore {
  Memory = "MEMORY",
}

export enum SqliteForeignKeys {
  On = "ON",
}

export enum SqliteConnectionRole {
  Writer = "writer",
  Reader = "reader",
}

export enum SqlitePragma {
  JournalMode = "journal_mode",
  Synchronous = "synchronous",
  BusyTimeout = "busy_timeout",
  CacheSize = "cache_size",
  ForeignKeys = "foreign_keys",
  TempStore = "temp_store",
  WalAutocheckpoint = "wal_autocheckpoint",
  MmapSize = "mmap_size",
}

export const SQLITE_BUSY_TIMEOUT_MS = 5000;

export const SQLITE_CACHE_SIZE_KIB = -64_000;

export const SQLITE_WAL_AUTOCHECKPOINT_PAGES = 1000;

export const SQLITE_MMAP_SIZE_BYTES = 67_108_864;

export const SQLITE_DEFAULT_READ_POOL_SIZE = 1;

export const SQLITE_MAX_READ_POOL_SIZE = 4;
