# ADR 0006: SQLite WAL Mode and Connection Pool Tuning

**Status:** Accepted  
**Date:** 2026-08-28  
**Deciders:** Stellar Stream Team

## Context

The default SQLite backend is a single-process, file-backed store used by the API, indexer, and webhook worker. Concurrent reads during writes, lock wait behavior, and page cache size need explicit settings. ADR 0001 selected SQLite; this record captures the connection-level tuning.

## Decision

Use Write-Ahead Logging with a small writer-plus-readonly pool and the following pragmas, applied in `backend/src/services/sqlite/`.

| Setting | Value | Reason |
| --- | --- | --- |
| `journal_mode` | `WAL` | Readers use the WAL snapshot and do not take the write lock. |
| `busy_timeout` | `5000` ms | Writers wait up to five seconds for a lock instead of failing immediately or waiting forever. |
| `cache_size` | `-64000` (64 MiB) | Negative values are KiB. 64 MiB fits typical stream/index working sets without unbounded RSS. |
| `synchronous` | `NORMAL` | Durable enough with WAL; avoids FULL fsync on every commit. |
| `wal_autocheckpoint` | `1000` pages | Caps WAL growth under steady write load. |
| `mmap_size` | `64 MiB` | Speeds repeated reads of hot pages. |
| `temp_store` | `MEMORY` | Keeps sorts and temp tables off disk for short queries. |

Connection pool:

- One writer connection for mutations and schema changes (`getDb()`).
- One readonly reader by default (`getReadDb()`), overridable with `SQLITE_READ_POOL_SIZE` (capped at 4).
- In-memory databases skip extra readers because each connection would be a separate database.

`better-sqlite3` is synchronous and does not implement a generic client pool. The extra readonly handles are the SQLite equivalent: concurrent readers against a single writer under WAL.

## Consequences

- Concurrent `SELECT`s on a reader connection observe a consistent snapshot while a writer transaction is open.
- `SQLITE_BUSY` after five seconds is a hard failure, not a hang.
- Memory use grows with `cache_size` and reader count; keep the read pool small on constrained hosts.

## References

- [SQLite WAL Mode](https://www.sqlite.org/wal.html)
- [PRAGMA busy_timeout](https://www.sqlite.org/pragma.html#pragma_busy_timeout)
- [PRAGMA cache_size](https://www.sqlite.org/pragma.html#pragma_cache_size)
